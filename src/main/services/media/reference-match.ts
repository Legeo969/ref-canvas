/**
 * 参考图仿色：把参考图的色彩分布拟合进一张 3D LUT，并渲染分屏对比用的预览图。
 *
 * 拟合与观感控制都在 `src/shared/match` 的纯函数里完成；本服务只负责主进程
 * 侧的解码、缓存、落盘和 URL 签发。解码结果单独做一层小 LRU，是因为拖动
 * 观感滑杆时参数指纹会变，但源图/参考图本身没变——每拖一次都重新解码
 * 1280px 的大图会直接卡住 UI 线程。
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { assetKindForExtension } from "../../../shared/asset-kind";
import type {
  ReferenceMatchAnalysis,
  ReferenceMatchControls,
  ReferenceMatchExportRequest,
  ReferenceMatchRequest,
  ReferenceMatchResult,
} from "../../../shared/contracts";
import {
  clamp01,
  matchDomainToSrgb,
  srgbToMatchDomain,
} from "../../../shared/match/colour";
import { fitGlobalResidualLut } from "../../../shared/match/global-match";
import { applyLookControls } from "../../../shared/match/look-controls";
import { analyseReference } from "../../../shared/match/reference-analysis";
import {
  renderResidualToSrgbBytes,
  writeCubeText,
  type ResidualLut,
} from "../../../shared/match/residual-lut";
import { extractVideoFrame } from "./ffmpeg-tools";

const DEFAULT_DIMENSION = 33;
const DEFAULT_PREVIEW_SIZE = 1280;
const MIN_PREVIEW_SIZE = 256;
const MAX_PREVIEW_SIZE = 4096;
const DEFAULT_LUT_TITLE = "RefCanvas reference match";
const DEFAULT_BASE_NAME = "reference-match";
/** 解码 LRU 容量：足够覆盖「内容图 + 多张参考图」的来回切换，又不会吃满内存。 */
const DECODE_CACHE_CAPACITY = 8;

export interface ReferenceMatchDependencies {
  cacheDirectory: string;
  /** 生成可给 <img> 用的 URL（生产传入 previewTokens.tokenFor + refbrowse 前缀，测试可传 file URL 构造器）。 */
  previewUrlFor(filePath: string): string;
  /** 登记缓存文件以便缓存淘汰（生产传 preview cache index）。 */
  registerCacheFile?(key: string, filePath: string): void;
}

interface DecodedImage {
  /** 解码样本，sRGB 0..1 交错 RGB。 */
  samples: Float32Array;
  /** 同一图像转到 Rec.709 Gamma 2.4 匹配域的结果（每次解码只算一次）。 */
  matchDomain: Float32Array;
  width: number;
  height: number;
  /** 实际解码的图片路径：视频是该时间点的抽帧 PNG，静态图是原路径。 */
  sourcePath: string;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertControls(controls: ReferenceMatchControls): void {
  for (const value of [
    controls.matchStrength,
    controls.shadows,
    controls.midtones,
    controls.highlights,
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error("REFERENCE_MATCH_CONTROLS_INVALID");
    }
  }
}

function controlsSignature(controls: ReferenceMatchControls): string {
  // 固定字段顺序：否则同一组参数经不同调用方（对象字面量顺序不同）会算出
  // 不同指纹，缓存永远命不中。
  return JSON.stringify({
    matchStrength: controls.matchStrength,
    shadows: controls.shadows,
    midtones: controls.midtones,
    highlights: controls.highlights,
    protectSkin: controls.protectSkin,
    protectSaturation: controls.protectSaturation,
    protectContrast: controls.protectContrast,
  });
}

function toMatchDomain(samples: Float32Array): Float32Array {
  const converted = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    converted[index] = srgbToMatchDomain(samples[index]);
  }
  return converted;
}

function toSrgbBytes(samples: Float32Array): Buffer {
  const bytes = Buffer.allocUnsafe(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    bytes[index] = Math.round(clamp01(samples[index]) * 255);
  }
  return bytes;
}

async function writeRgbPng(
  filename: string,
  bytes: Buffer,
  width: number,
  height: number,
): Promise<void> {
  await sharp(bytes, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 3 })
    .toFile(filename);
}

function sanitizeBaseName(value: string): string {
  // 与仓库其它导出入口同一套字符集；额外去掉结尾的 .cube，避免
  // “name.cube” 变成 “name.cube.cube”。
  const withoutExtension = value.replace(/\.cube$/i, "");
  const cleaned = withoutExtension.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return cleaned || DEFAULT_BASE_NAME;
}

async function lutTitle(lutPath: string): Promise<string | null> {
  const text = await readFile(lutPath, "utf8").catch(() => "");
  const match = /^TITLE\s+"([^"]*)"/m.exec(text);
  return match?.[1]?.trim() || null;
}

export function createReferenceMatchService(deps: ReferenceMatchDependencies) {
  /** 插入顺序即最近使用顺序（Map 迭代顺序）。 */
  const decodeCache = new Map<string, DecodedImage>();
  /**
   * 拟合结果与观感参数无关：拖滑杆时可以省掉 190ms 量级的重拟合，只重做
   * 14ms 的控制与一次渲染。容量 4 足够覆盖「同一画面几套观感来回试」。
   */
  const fitCache = new Map<string, ResidualLut>();

  function rememberDecoded(key: string, decoded: DecodedImage): void {
    decodeCache.delete(key);
    decodeCache.set(key, decoded);
    while (decodeCache.size > DECODE_CACHE_CAPACITY) {
      const oldest = decodeCache.keys().next().value;
      if (oldest === undefined) break;
      decodeCache.delete(oldest);
    }
  }

  async function decodeRaw(filePath: string, previewSize: number): Promise<DecodedImage> {
    const { data, info } = await sharp(filePath, { failOn: "none" })
      .rotate()
      .removeAlpha()
      .resize({
        width: previewSize,
        height: previewSize,
        fit: "inside",
        // 小参考图只做分析/预览，不该被放大成 1280px 再算色板。
        withoutEnlargement: true,
      })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const samples = new Float32Array(info.width * info.height * 3);
    for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
      const source = pixel * info.channels;
      samples[pixel * 3] = data[source] / 255;
      samples[pixel * 3 + 1] = data[source + 1] / 255;
      samples[pixel * 3 + 2] = data[source + 2] / 255;
    }
    return {
      samples,
      matchDomain: toMatchDomain(samples),
      width: info.width,
      height: info.height,
      sourcePath: filePath,
    };
  }

  async function extractFrame(
    filePath: string,
    identity: string,
    timeMs: number,
    previewSize: number,
  ): Promise<string> {
    // 抽帧缓存键必须包含时间点与预览尺寸：只用文件身份做键会让第二次
    // 换时间点的调用直接复用上一帧，画面和 LUT 都会静默错位。
    const target = path.join(
      deps.cacheDirectory,
      `match-frame-${hashText(`${identity}:${Math.round(timeMs)}:${previewSize}`).slice(0, 20)}.png`,
    );
    const existing = await stat(target).catch(() => null);
    if (!existing?.isFile()) {
      await mkdir(deps.cacheDirectory, { recursive: true });
      await extractVideoFrame(filePath, timeMs, target, {
        width: previewSize,
        height: previewSize,
      });
    }
    deps.registerCacheFile?.(`reference-match:frame:${path.normalize(target)}`, target);
    return target;
  }

  async function loadImage(
    filePath: string,
    previewSize: number,
    timeMs: number,
    unavailableCode: string,
  ): Promise<DecodedImage> {
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) throw new Error(unavailableCode);
    const identity = `${path.normalize(filePath)}:${info.size}:${info.mtimeMs}`;
    // 键含 timeMs / previewSize：同一视频换时间点或换预览尺寸必须重新解码。
    const key = `${identity}:${timeMs}:${previewSize}`;
    const cached = decodeCache.get(key);
    if (cached) {
      rememberDecoded(key, cached);
      return cached;
    }
    const extension = path.extname(filePath).replace(/^\./, "").toLowerCase();
    let sourcePath = filePath;
    try {
      // 视频没有单张位图可解，先按时间点抽一帧到缓存目录，再走同一条 sharp 路径。
      if (assetKindForExtension(extension) === "video") {
        sourcePath = await extractFrame(filePath, identity, timeMs, previewSize);
      }
      const decoded = await decodeRaw(sourcePath, previewSize);
      rememberDecoded(key, decoded);
      return decoded;
    } catch {
      throw new Error(unavailableCode);
    }
  }

  /** 参考图槽位的展示缩略图：320px PNG，按参考图身份缓存。 */
  async function referencePreview(decoded: DecodedImage): Promise<string> {
    const info = await stat(decoded.sourcePath).catch(() => null);
    const identity = hashText(
      `${path.normalize(decoded.sourcePath)}:${info?.size ?? 0}:${info?.mtimeMs ?? 0}:${decoded.width}x${decoded.height}`,
    ).slice(0, 20);
    const filename = path.join(deps.cacheDirectory, `match-reference-${identity}.png`);
    const existing = await stat(filename).catch(() => null);
    if (!existing?.isFile()) {
      await mkdir(deps.cacheDirectory, { recursive: true });
      await sharp(toSrgbBytes(decoded.samples), {
        raw: { width: decoded.width, height: decoded.height, channels: 3 },
      })
        .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 3 })
        .toFile(filename);
    }
    deps.registerCacheFile?.(`reference-match:reference:${identity}`, filename);
    return deps.previewUrlFor(filename);
  }

  async function analyse(referencePath: string): Promise<ReferenceMatchAnalysis> {
    const decoded = await loadImage(
      referencePath,
      DEFAULT_PREVIEW_SIZE,
      0,
      "REFERENCE_MATCH_REFERENCE_UNAVAILABLE",
    );
    const analysis = analyseReference(decoded.samples, 10);
    // 面板里的参考图槽位要能显示任意输入：原文件可能是浏览器不解的类型
    // （EXR/PSD/HEIC），所以这里输出一张与统计同源的 PNG，而不是把原
    // 文件路径交给 <img>。
    const previewUrl = await referencePreview(decoded);
    return {
      url: previewUrl,
      width: decoded.width,
      height: decoded.height,
      palette: analysis.mainColours.map((entry) => ({
        hex: entry.hex,
        rgb: entry.rgb,
        coverage: entry.coverage,
      })),
      brightness: analysis.brightness,
      saturation: analysis.saturation,
      hue: analysis.hue,
    };
  }

  async function create(request: ReferenceMatchRequest): Promise<ReferenceMatchResult> {
    assertControls(request.controls);
    const dimension = request.dimension ?? DEFAULT_DIMENSION;
    if (dimension !== 33 && dimension !== 65) {
      throw new Error("REFERENCE_MATCH_DIMENSION_INVALID");
    }
    const previewSize = request.previewSize ?? DEFAULT_PREVIEW_SIZE;
    if (
      !Number.isInteger(previewSize) ||
      previewSize < MIN_PREVIEW_SIZE ||
      previewSize > MAX_PREVIEW_SIZE
    ) {
      throw new Error("REFERENCE_MATCH_PREVIEW_SIZE_INVALID");
    }
    const timeMs = request.timeMs ?? 0;

    const sourceInfo = await stat(request.sourcePath).catch(() => null);
    if (!sourceInfo?.isFile()) throw new Error("REFERENCE_MATCH_SOURCE_UNAVAILABLE");
    const referenceInfo = await stat(request.referencePath).catch(() => null);
    if (!referenceInfo?.isFile()) throw new Error("REFERENCE_MATCH_REFERENCE_UNAVAILABLE");

    // 三层指纹：内容（源图/时间点/预览尺寸）、拟合（再加参考图与网格）、
    // 结果（再加观感参数）。分开才能让拖滑杆时复用解码与拟合。
    const contentFingerprint = hashText(
      [
        path.normalize(request.sourcePath),
        sourceInfo.size,
        sourceInfo.mtimeMs,
        timeMs,
        previewSize,
      ].join(":"),
    ).slice(0, 24);
    const fitFingerprint = hashText(
      [
        contentFingerprint,
        path.normalize(request.referencePath),
        referenceInfo.size,
        referenceInfo.mtimeMs,
        dimension,
      ].join(":"),
    ).slice(0, 24);
    const resultFingerprint = hashText(
      `${fitFingerprint}:${controlsSignature(request.controls)}`,
    ).slice(0, 24);

    const originalPath = path.join(
      deps.cacheDirectory,
      `match-${contentFingerprint}-original.png`,
    );
    const previewPath = path.join(
      deps.cacheDirectory,
      `match-${resultFingerprint}-preview.png`,
    );
    const lutPath = path.join(deps.cacheDirectory, `match-${resultFingerprint}.cube`);

    const cachedResult = async (): Promise<ReferenceMatchResult | null> => {
      const [previewInfo, originalInfo, lutInfo] = await Promise.all([
        stat(previewPath).then((item) => item.isFile(), () => false),
        stat(originalPath).then((item) => item.isFile(), () => false),
        stat(lutPath).then((item) => item.isFile(), () => false),
      ]);
      if (!previewInfo || !originalInfo || !lutInfo) return null;
      const metadata = await sharp(previewPath).metadata().catch(() => null);
      if (!metadata?.width || !metadata.height) return null;
      for (const [key, file] of [
        [`reference-match:${resultFingerprint}:preview`, previewPath],
        [`reference-match:${contentFingerprint}:original`, originalPath],
        [`reference-match:${resultFingerprint}:lut`, lutPath],
      ] as const) {
        deps.registerCacheFile?.(key, file);
      }
      return {
        previewUrl: deps.previewUrlFor(previewPath),
        originalUrl: deps.previewUrlFor(originalPath),
        lutPath,
        width: metadata.width,
        height: metadata.height,
      };
    };

    const cached = await cachedResult();
    if (cached) return cached;

    const source = await loadImage(
      request.sourcePath,
      previewSize,
      timeMs,
      "REFERENCE_MATCH_SOURCE_UNAVAILABLE",
    );
    const reference = await loadImage(
      request.referencePath,
      previewSize,
      0,
      "REFERENCE_MATCH_REFERENCE_UNAVAILABLE",
    );

    // 参考图的分布不随源图时间点变化，所以参考图固定取第 0 帧解码，
    // 同一张参考图在不同镜头间可以直接命中解码与拟合缓存。
    let fitted = fitCache.get(fitFingerprint);
    if (fitted) {
      fitCache.delete(fitFingerprint);
      fitCache.set(fitFingerprint, fitted);
    } else {
      fitted = fitGlobalResidualLut(source.matchDomain, reference.matchDomain, dimension);
      fitCache.set(fitFingerprint, fitted);
      while (fitCache.size > 4) {
        const oldest = fitCache.keys().next().value;
        if (oldest === undefined) break;
        fitCache.delete(oldest);
      }
    }
    const lut = applyLookControls(fitted, request.controls);

    // 渲染与编码一次走完：预览像素量是百万级，多一趟拷贝就是多几十毫秒。
    const previewBytes = Buffer.allocUnsafe(source.samples.length);
    renderResidualToSrgbBytes(lut, source.matchDomain, previewBytes, matchDomainToSrgb);

    await mkdir(deps.cacheDirectory, { recursive: true });
    const originalReady = await stat(originalPath).then(
      (item) => item.isFile(),
      () => false,
    );
    if (!originalReady) {
      await writeRgbPng(
        originalPath,
        toSrgbBytes(source.samples),
        source.width,
        source.height,
      );
    }
    await writeRgbPng(previewPath, previewBytes, source.width, source.height);
    const controls = request.controls;
    const comments = [
      "Input domain: Rec.709 Gamma 2.4",
      "Reference image converted from sRGB to the Rec.709 Gamma 2.4 match domain",
      `Match strength: ${controls.matchStrength}%`,
      `Tone zones: shadows ${controls.shadows}%, midtones ${controls.midtones}%, highlights ${controls.highlights}%`,
      `Safeguards: skin ${controls.protectSkin ? "on" : "off"}, saturation ${controls.protectSaturation ? "on" : "off"}, contrast ${controls.protectContrast ? "on" : "off"}`,
      `Grid: ${dimension}^3`,
    ];
    await writeFile(
      lutPath,
      writeCubeText(lut, {
        title: DEFAULT_LUT_TITLE,
        comments,
        outputLimits: [0, 1],
      }),
      "utf8",
    );

    for (const [key, file] of [
      [`reference-match:${resultFingerprint}:preview`, previewPath],
      [`reference-match:${contentFingerprint}:original`, originalPath],
      [`reference-match:${resultFingerprint}:lut`, lutPath],
    ] as const) {
      deps.registerCacheFile?.(key, file);
    }

    return {
      previewUrl: deps.previewUrlFor(previewPath),
      originalUrl: deps.previewUrlFor(originalPath),
      lutPath,
      width: source.width,
      height: source.height,
    };
  }

  async function exportLut(
    request: ReferenceMatchExportRequest,
  ): Promise<{ path: string }> {
    const targetInfo = await stat(request.targetDirectory).catch(() => null);
    if (!targetInfo?.isDirectory()) throw new Error("REFERENCE_MATCH_TARGET_MISSING");
    const lutInfo = await stat(request.lutPath).catch(() => null);
    if (!lutInfo?.isFile()) throw new Error("REFERENCE_MATCH_LUT_MISSING");

    const requestedName = request.baseName?.trim();
    const baseName = sanitizeBaseName(
      requestedName || (await lutTitle(request.lutPath)) || DEFAULT_BASE_NAME,
    );
    for (let suffix = 0; suffix < 10_000; suffix += 1) {
      const candidate = path.join(
        request.targetDirectory,
        `${baseName}${suffix === 0 ? "" : `-${suffix}`}.cube`,
      );
      const existing = await stat(candidate).catch(() => null);
      if (existing) continue;
      await copyFile(request.lutPath, candidate);
      return { path: candidate };
    }
    throw new Error("REFERENCE_MATCH_EXPORT_UNAVAILABLE");
  }

  return { analyse, create, exportLut };
}
