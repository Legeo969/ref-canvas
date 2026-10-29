/**
 * 参考图仿色：把参考图的色彩分布拟合进一张 3D LUT，并渲染分屏对比用的预览图。
 *
 * 拟合与观感控制都在 `src/shared/match` 的纯函数里完成；本服务只负责主进程
 * 侧的解码、缓存、落盘和 URL 签发。解码结果单独做一层小 LRU，是因为拖动
 * 观感滑杆时参数指纹会变，但源图/参考图本身没变——每拖一次都重新解码
 * 1280px 的大图会直接卡住 UI 线程。
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { assetKindForExtension } from "../../../shared/asset-kind";
import type {
  ReferenceMatchAnalysis,
  ReferenceMatchControls,
  ReferenceMatchExportPngRequest,
  ReferenceMatchExportRequest,
  ReferenceMatchLibraryImportRequest,
  ReferenceMatchRequest,
  ReferenceMatchResult,
  ReferenceMatchSettings,
  ReferenceMatchSettingsPatch,
} from "../../../shared/contracts";
import {
  clamp01,
  matchDomainToSrgb,
  srgbToMatchDomain,
} from "../../../shared/match/colour";
import {
  bakeDwgIntermediateResidual,
  bakeSlog3ToRec709Residual,
  dwgIntermediateToRec709Gamma24,
  parseBaselineCube,
  precompensateDwgLutResidualForResolveRec709,
  rec709Gamma24ToDwgIntermediate,
  resolveDwgToRec709Gamma24,
  slog3ToDisplayMatchDomain,
  usesSonyLc709Baseline,
  type Slog3Gamut,
  type Slog3InputRange,
} from "../../../shared/match/colour-management";
import { fitDwgResidualLut, fitGlobalResidualLut } from "../../../shared/match/global-match";
import { applyLookControls } from "../../../shared/match/look-controls";
import { analyseReference } from "../../../shared/match/reference-analysis";
import {
  renderResidualToBytes,
  renderResidualToSrgbBytes,
  writeCubeText,
  type ResidualLut,
} from "../../../shared/match/residual-lut";
import { extractVideoFrame, decodeImageToRgb48 } from "./ffmpeg-tools";

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
  /** 参考图仿色自己的设置文件（产出目录、Resolve LUT 库、输出补偿）。 */
  settingsPath: string;
  /** 默认产出目录：用户未自定义时写到这里。 */
  defaultExportDirectory: string;
  /** 生成可给 <img> 用的 URL（生产传入 previewTokens.tokenFor + refbrowse 前缀，测试可传 file URL 构造器）。 */
  previewUrlFor(filePath: string): string;
  /** 登记缓存文件以便缓存淘汰（生产传 preview cache index）。 */
  registerCacheFile?(key: string, filePath: string): void;
  /** 平台默认的 Resolve LUT 库目录。 */
  resolveLutDirectory?: string;
  /** 可选的 Sony S-Log3/S-Gamut3.Cine → LC-709 基线 cube（不可再分发，从磁盘读）。 */
  sonyBaselineCubePath?: string | null;
}

interface DecodedImage {
  /** 解码样本，sRGB 0..1 交错 RGB（DPX 时为未经转换的 16-bit 码值）。 */
  samples: Float32Array;
  /** sRGB 编码源转到 Rec.709 Gamma 2.4 匹配域的结果（DPX 源不用）。 */
  matchDomain: Float32Array;
  width: number;
  height: number;
  /** 实际解码的图片路径：视频是该时间点的抽帧 PNG，静态图是原路径。 */
  sourcePath: string;
  /** DPX 里装的是工作空间码值（DWG/DI 或原生 S-Log3），不能当 sRGB 图像用。 */
  isDpx: boolean;
}

function isDpxPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".dpx";
}

/** 最近邻抽取：DPX 码值不能在缩小过程中被插值重采样。 */
function decimateSamples(
  samples: Float32Array,
  width: number,
  height: number,
  maxSize: number,
): { samples: Float32Array; width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSize) return { samples, width, height };
  const step = Math.ceil(longest / maxSize);
  const outWidth = Math.max(1, Math.floor(width / step));
  const outHeight = Math.max(1, Math.floor(height / step));
  const result = new Float32Array(outWidth * outHeight * 3);
  for (let y = 0; y < outHeight; y += 1) {
    const sourceRow = y * step * width;
    for (let x = 0; x < outWidth; x += 1) {
      const source = (sourceRow + x * step) * 3;
      const target = (y * outWidth + x) * 3;
      result[target] = samples[source];
      result[target + 1] = samples[source + 1];
      result[target + 2] = samples[source + 2];
    }
  }
  return { samples: result, width: outWidth, height: outHeight };
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

/** S-Log3 码值 → 匹配域（Rec.709 Gamma 2.4），可选 Sony LC-709 基线。 */
function restoreSlog3(
  samples: Float32Array,
  gamut: Slog3Gamut,
  inputRange: Slog3InputRange,
  sonyBaseline: ResidualLut | null,
): Float32Array {
  const restored = new Float32Array(samples.length);
  for (let offset = 0; offset + 2 < samples.length; offset += 3) {
    const converted = slog3ToDisplayMatchDomain(
      samples[offset],
      samples[offset + 1],
      samples[offset + 2],
      { gamut, inputRange, sonyBaseline },
    );
    restored[offset] = converted[0];
    restored[offset + 1] = converted[1];
    restored[offset + 2] = converted[2];
  }
  return restored;
}

/** 显示域样本 → DWG/DI 码值（非 DPX 源在 DWG 工作空间下的节点输入）。 */
function toDwgSamples(displaySamples: Float32Array): Float32Array {
  const converted = new Float32Array(displaySamples.length);
  for (let offset = 0; offset + 2 < displaySamples.length; offset += 3) {
    const value = rec709Gamma24ToDwgIntermediate(
      displaySamples[offset],
      displaySamples[offset + 1],
      displaySamples[offset + 2],
    );
    converted[offset] = value[0];
    converted[offset + 1] = value[1];
    converted[offset + 2] = value[2];
  }
  return converted;
}

/** DWG/DI 码值 → 显示域（对比用的“原图”侧）。 */
function dwgSamplesToDisplay(dwgSamples: Float32Array): Float32Array {
  const converted = new Float32Array(dwgSamples.length);
  for (let offset = 0; offset + 2 < dwgSamples.length; offset += 3) {
    const value = dwgIntermediateToRec709Gamma24(
      dwgSamples[offset],
      dwgSamples[offset + 1],
      dwgSamples[offset + 2],
    );
    converted[offset] = value[0];
    converted[offset + 1] = value[1];
    converted[offset + 2] = value[2];
  }
  return converted;
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

  /** Sony LC-709 基线 cube 只读一次；缺失时退回解析式还原。 */
  let sonyBaseline: ResidualLut | null | undefined;

  async function loadSonyBaseline(): Promise<ResidualLut | null> {
    if (sonyBaseline !== undefined) return sonyBaseline;
    const cubePath = deps.sonyBaselineCubePath;
    if (!cubePath) {
      sonyBaseline = null;
      return null;
    }
    try {
      sonyBaseline = parseBaselineCube(await readFile(cubePath, "utf8"));
    } catch {
      sonyBaseline = null;
    }
    return sonyBaseline;
  }

  interface StoredSettings {
    outputDirectory: string;
    resolveLutDirectory: string;
    resolveOutputCompensation: boolean;
  }

  async function readSettings(): Promise<StoredSettings> {
    const fallback: StoredSettings = {
      outputDirectory: deps.defaultExportDirectory,
      resolveLutDirectory: deps.resolveLutDirectory ?? "",
      resolveOutputCompensation: true,
    };
    try {
      const raw = JSON.parse(await readFile(deps.settingsPath, "utf8")) as Partial<StoredSettings>;
      return {
        outputDirectory:
          typeof raw.outputDirectory === "string" && raw.outputDirectory.trim()
            ? raw.outputDirectory
            : fallback.outputDirectory,
        resolveLutDirectory:
          typeof raw.resolveLutDirectory === "string" && raw.resolveLutDirectory.trim()
            ? raw.resolveLutDirectory
            : fallback.resolveLutDirectory,
        resolveOutputCompensation: raw.resolveOutputCompensation !== false,
      };
    } catch {
      return fallback;
    }
  }

  async function writeSettings(next: StoredSettings): Promise<void> {
    await mkdir(path.dirname(deps.settingsPath), { recursive: true });
    await writeFile(deps.settingsPath, JSON.stringify(next, null, 2), "utf8");
  }

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
    if (isDpxPath(filePath)) {
      // DPX 走 ffmpeg 的 rgb48le 直解：sharp 读不了，且不能把它当 sRGB 解。
      const decoded = await decodeImageToRgb48(filePath);
      const reduced = decimateSamples(decoded.samples, decoded.width, decoded.height, previewSize);
      return {
        samples: reduced.samples,
        // DPX 码值已在工作空间里，没有"sRGB 匹配域"这一说；字段留空数组
        // 比编一个假值更容易在调用方发现用错。
        matchDomain: new Float32Array(0),
        width: reduced.width,
        height: reduced.height,
        sourcePath: filePath,
        isDpx: true,
      };
    }
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
      isDpx: false,
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
      scopes: analysis.scopes,
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
    if (isDpxPath(request.referencePath)) {
      // 参考图必须是已经显示为目标风格的 sRGB 图像；DPX 是工作空间码值，
      // 拿它当“参考风格”在概念上就不成立。
      throw new Error("REFERENCE_MATCH_REFERENCE_DPX_UNSUPPORTED");
    }
    const workspace = request.workspace ?? "rec709";
    const slog3Gamut: Slog3Gamut = request.slog3Gamut ?? "sgamut3-cine";
    const slog3InputRange: Slog3InputRange = request.slog3InputRange ?? "full";
    const sourceIsDpx = isDpxPath(request.sourcePath);
    if (sourceIsDpx && workspace === "rec709") {
      throw new Error("REFERENCE_MATCH_DPX_REQUIRES_WORKSPACE");
    }
    if (workspace === "slog3" && !sourceIsDpx) {
      // S-Log3 LUT 必须套在原生 S-Log3 素材上；已还原的图像不能反过来当源。
      throw new Error("REFERENCE_MATCH_SLOG3_REQUIRES_DPX");
    }
    const compensationSetting = (await readSettings()).resolveOutputCompensation;
    const resolveOutputCompensation =
      workspace === "dwg" ? (request.resolveOutputCompensation ?? compensationSetting) : false;

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
    const workspaceSignature = [
      workspace,
      workspace === "slog3" ? slog3Gamut : "-",
      workspace === "slog3" ? slog3InputRange : "-",
      workspace === "dwg" && resolveOutputCompensation ? "compensated" : "-",
    ].join(":");
    const fitFingerprint = hashText(
      [
        contentFingerprint,
        path.normalize(request.referencePath),
        referenceInfo.size,
        referenceInfo.mtimeMs,
        dimension,
        workspaceSignature,
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
        previewPath,
        lutPath,
        width: metadata.width,
        height: metadata.height,
        workspace,
        slog3Gamut: workspace === "slog3" ? slog3Gamut : undefined,
        slog3InputRange: workspace === "slog3" ? slog3InputRange : undefined,
        resolveOutputCompensation,
        baseline:
          workspace !== "slog3"
            ? "none"
            : usesSonyLc709Baseline(slog3Gamut, slog3InputRange) && deps.sonyBaselineCubePath
              ? "sony-lc709"
              : "analytical",
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
    // 参考图永远是 sRGB 图像（DPX 已被拒），所以直接取匹配域。
    const referenceDisplay = reference.matchDomain.length
      ? reference.matchDomain
      : toMatchDomain(reference.samples);
    const sonyBaseline = workspace === "slog3" ? await loadSonyBaseline() : null;

    let fitted = fitCache.get(fitFingerprint);
    if (fitted) {
      fitCache.delete(fitFingerprint);
      fitCache.set(fitFingerprint, fitted);
    } else {
      if (workspace === "dwg" && source.isDpx) {
        // DPX 直拟：栅格一开始就建在 DWG/DI 里，参考图同步转进同一空间。
        fitted = fitDwgResidualLut(source.samples, referenceDisplay, dimension);
      } else if (workspace === "slog3") {
        fitted = fitGlobalResidualLut(
          restoreSlog3(source.samples, slog3Gamut, slog3InputRange, sonyBaseline),
          referenceDisplay,
          dimension,
        );
      } else {
        fitted = fitGlobalResidualLut(source.matchDomain, referenceDisplay, dimension);
      }
      fitCache.set(fitFingerprint, fitted);
      while (fitCache.size > 4) {
        const oldest = fitCache.keys().next().value;
        if (oldest === undefined) break;
        fitCache.delete(oldest);
      }
    }
    let lut = applyLookControls(fitted, request.controls);

    // 预览必须与导出的 cube 走同一条变换，否则用户在面板里看到的和 Resolve
    // 里套出来的是两张东西。
    const previewBytes = Buffer.allocUnsafe(source.samples.length);
    let originalBytes: Buffer;
    if (workspace === "dwg") {
      if (!source.isDpx) lut = bakeDwgIntermediateResidual(lut, dimension);
      if (resolveOutputCompensation) {
        lut = precompensateDwgLutResidualForResolveRec709(lut);
      }
      const previewInput = source.isDpx ? source.samples : toDwgSamples(source.matchDomain);
      const calibrate = resolveOutputCompensation
        ? resolveDwgToRec709Gamma24
        : dwgIntermediateToRec709Gamma24;
      renderResidualToBytes(lut, previewInput, previewBytes, (red, green, blue) => {
        const display = calibrate(red, green, blue);
        return [
          matchDomainToSrgb(display[0]),
          matchDomainToSrgb(display[1]),
          matchDomainToSrgb(display[2]),
        ];
      });
      // 左侧原图用“标准变换后的画面”，而不是把 DI 码值当 sRGB 直接铺开：
      // 后者只是一片死黑，没有任何判断价值。
      originalBytes = toSrgbBytes(
        source.isDpx ? dwgSamplesToDisplay(source.samples) : source.samples,
      );
    } else if (workspace === "slog3") {
      lut = bakeSlog3ToRec709Residual(lut, dimension, {
        gamut: slog3Gamut,
        inputRange: slog3InputRange,
        sonyBaseline,
      });
      renderResidualToBytes(lut, source.samples, previewBytes, (red, green, blue) => [
        matchDomainToSrgb(red),
        matchDomainToSrgb(green),
        matchDomainToSrgb(blue),
      ]);
      originalBytes = toSrgbBytes(
        restoreSlog3(source.samples, slog3Gamut, slog3InputRange, sonyBaseline),
      );
    } else {
      // 渲染与编码一次走完：预览像素量是百万级，多一趟拷贝就是多几十毫秒。
      renderResidualToSrgbBytes(lut, source.matchDomain, previewBytes, matchDomainToSrgb);
      originalBytes = toSrgbBytes(source.samples);
    }

    await mkdir(deps.cacheDirectory, { recursive: true });
    const originalReady = await stat(originalPath).then(
      (item) => item.isFile(),
      () => false,
    );
    if (!originalReady) {
      await writeRgbPng(originalPath, originalBytes, source.width, source.height);
    }
    await writeRgbPng(previewPath, previewBytes, source.width, source.height);
    const controls = request.controls;
    const workspaceLabel =
      workspace === "dwg"
        ? "DaVinci Wide Gamut + Intermediate"
        : workspace === "slog3"
          ? `Sony S-Log3 / ${slog3Gamut === "sgamut3" ? "S-Gamut3" : "S-Gamut3.Cine"} (${slog3InputRange} range)`
          : "Rec.709 Gamma 2.4";
    const comments = [
      `Input domain: ${workspaceLabel}`,
      workspace === "rec709"
        ? "Reference image converted from sRGB to the Rec.709 Gamma 2.4 match domain"
        : workspace === "dwg"
          ? "Reference image converted into the DWG/DI working space for the lattice fit"
          : "S-Log3 still restored through the selected display baseline before matching",
      `Match strength: ${controls.matchStrength}%`,
      `Tone zones: shadows ${controls.shadows}%, midtones ${controls.midtones}%, highlights ${controls.highlights}%`,
      `Safeguards: skin ${controls.protectSkin ? "on" : "off"}, saturation ${controls.protectSaturation ? "on" : "off"}, contrast ${controls.protectContrast ? "on" : "off"}`,
      `Grid: ${dimension}^3`,
      workspace === "dwg"
        ? `Resolve DWG-to-Rec.709 output-response compensation: ${resolveOutputCompensation ? "enabled" : "disabled"}`
        : "Resolve DWG-to-Rec.709 output-response compensation: not applicable",
      workspace === "slog3"
        ? `S-Log3 display baseline: ${
            usesSonyLc709Baseline(slog3Gamut, slog3InputRange) && sonyBaseline
              ? "Sony LC-709 Look Profile"
              : "analytical S-Log3 -> Rec.709 Gamma 2.4"
          }`
        : "S-Log3 display baseline: not applicable",
    ];
    await writeFile(
      lutPath,
      writeCubeText(lut, {
        // DWG 的 cube 保留工作空间余量，不能把超过 1.0 的高光截断；
        // 显示参考的导出才写 0..1。
        title: `${DEFAULT_LUT_TITLE} · ${workspace}`,
        comments,
        outputLimits: workspace === "dwg" ? undefined : [0, 1],
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
      previewPath,
      lutPath,
      width: source.width,
      height: source.height,
      workspace,
      slog3Gamut: workspace === "slog3" ? slog3Gamut : undefined,
      slog3InputRange: workspace === "slog3" ? slog3InputRange : undefined,
      resolveOutputCompensation,
      baseline:
        workspace !== "slog3"
          ? "none"
          : usesSonyLc709Baseline(slog3Gamut, slog3InputRange) && sonyBaseline
            ? "sony-lc709"
            : "analytical",
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

  async function uniqueTarget(directory: string, baseName: string, extension: string): Promise<string> {
    for (let suffix = 0; suffix < 10_000; suffix += 1) {
      const candidate = path.join(
        directory,
        `${baseName}${suffix === 0 ? "" : `-${suffix}`}.${extension}`,
      );
      const existing = await stat(candidate).catch(() => null);
      if (!existing) return candidate;
    }
    throw new Error("REFERENCE_MATCH_EXPORT_UNAVAILABLE");
  }

  async function exportPng(
    request: ReferenceMatchExportPngRequest,
  ): Promise<{ path: string }> {
    const targetInfo = await stat(request.targetDirectory).catch(() => null);
    if (!targetInfo?.isDirectory()) throw new Error("REFERENCE_MATCH_TARGET_MISSING");
    const info = await stat(request.previewPath).catch(() => null);
    if (!info?.isFile()) throw new Error("REFERENCE_MATCH_PREVIEW_MISSING");
    const baseName = sanitizeBaseName(request.baseName?.trim() || "reference-match-preview");
    const target = await uniqueTarget(request.targetDirectory, baseName, "png");
    await copyFile(request.previewPath, target);
    return { path: target };
  }

  async function importToLibrary(
    request: ReferenceMatchLibraryImportRequest,
  ): Promise<{ path: string }> {
    const info = await stat(request.lutPath).catch(() => null);
    if (!info?.isFile() || path.extname(request.lutPath).toLowerCase() !== ".cube") {
      throw new Error("REFERENCE_MATCH_LUT_MISSING");
    }
    const stored = await readSettings();
    if (!request.targetDirectory && !stored.resolveLutDirectory) {
      throw new Error("REFERENCE_MATCH_LIBRARY_DIRECTORY_MISSING");
    }
    const directory = request.targetDirectory
      ? path.resolve(request.targetDirectory)
      : path.join(path.resolve(stored.resolveLutDirectory), "Reference LUT");
    const baseName = sanitizeBaseName(
      request.name?.trim() || (await lutTitle(request.lutPath)) || DEFAULT_BASE_NAME,
    );
    const target = path.join(directory, `${baseName}.cube`);
    if (await stat(target).then((item) => item.isFile(), () => false)) {
      throw new Error("REFERENCE_MATCH_LIBRARY_EXISTS");
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(request.lutPath, target);
    return { path: target };
  }

  async function clearCache(): Promise<{ removed: number }> {
    let removed = 0;
    const sweep = async (directory: string, prefixes: readonly string[]) => {
      const entries = await readdir(directory).catch(() => [] as string[]);
      for (const entry of entries) {
        if (!prefixes.some((prefix) => entry.startsWith(prefix))) continue;
        const extension = path.extname(entry).toLowerCase();
        if (![".cube", ".png", ".json"].includes(extension)) continue;
        await unlink(path.join(directory, entry)).catch(() => undefined);
        removed += 1;
      }
    };
    await sweep(deps.cacheDirectory, ["match-"]);
    const stored = await readSettings();
    if (stored.outputDirectory) {
      await sweep(path.resolve(stored.outputDirectory), ["reference-match-"]);
    }
    decodeCache.clear();
    fitCache.clear();
    return { removed };
  }

  async function getSettings(): Promise<ReferenceMatchSettings> {
    const stored = await readSettings();
    const outputDirectory = path.resolve(stored.outputDirectory);
    return {
      outputDirectory,
      isDefault: outputDirectory === path.resolve(deps.defaultExportDirectory),
      resolveLutDirectory: stored.resolveLutDirectory
        ? path.resolve(stored.resolveLutDirectory)
        : "",
      resolveOutputCompensation: stored.resolveOutputCompensation,
      sonyBaselineCubePath: deps.sonyBaselineCubePath ?? null,
    };
  }

  async function updateSettings(
    patch: ReferenceMatchSettingsPatch,
  ): Promise<ReferenceMatchSettings> {
    const current = await readSettings();
    const next: StoredSettings = { ...current };
    if (patch.useDefault === true) {
      next.outputDirectory = deps.defaultExportDirectory;
    } else if (typeof patch.outputDirectory === "string") {
      const candidate = patch.outputDirectory.trim();
      if (!candidate) throw new Error("REFERENCE_MATCH_OUTPUT_DIRECTORY_INVALID");
      const resolved = path.resolve(candidate);
      await mkdir(resolved, { recursive: true });
      next.outputDirectory = resolved;
    }
    if (typeof patch.resolveLutDirectory === "string") {
      const candidate = patch.resolveLutDirectory.trim();
      if (!candidate) throw new Error("REFERENCE_MATCH_LIBRARY_DIRECTORY_INVALID");
      next.resolveLutDirectory = path.resolve(candidate);
    }
    if (typeof patch.resolveOutputCompensation === "boolean") {
      next.resolveOutputCompensation = patch.resolveOutputCompensation;
    }
    await writeSettings(next);
    return getSettings();
  }

  return {
    analyse,
    create,
    exportLut,
    exportPng,
    importToLibrary,
    clearCache,
    getSettings,
    updateSettings,
  };
}
