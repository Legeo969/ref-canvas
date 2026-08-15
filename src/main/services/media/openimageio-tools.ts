import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OIIO_RELATIVE_PATH = path.join(
  "assets",
  "native",
  "openimageio",
  "win32-x64",
  "oiiotool.exe",
);

/**
 * Locate the checked-in OpenImageIO sidecar in development and in the
 * app.asar.unpacked release layout. REFCANVAS_OIIOTOOL is intentionally
 * supported for tests and decoder diagnostics only.
 */
export interface OiiotoolRuntimeContext {
  resourcesPath?: string;
  defaultApp?: boolean;
  override?: string;
  cwd?: string;
}

export function packagedOiiotoolCandidates(
  context?: OiiotoolRuntimeContext,
): string[] {
  const electronProcess = process as NodeJS.Process & { resourcesPath?: string; defaultApp?: boolean };
  const runtime = context ?? {
    resourcesPath: electronProcess.resourcesPath,
    defaultApp: electronProcess.defaultApp,
    override: process.env.REFCANVAS_OIIOTOOL,
    cwd: process.cwd(),
  };
  const resourcesPath = runtime.resourcesPath;
  // provider worker 线程不继承 process.defaultApp（值为 undefined，会被
  // 误判为打包环境、只找 app.asar.unpacked，dev 模式因此找不到侧车）。
  // 主进程在创建 worker 前写入 REFCANVAS_PACKAGED 显式传递打包状态；
  // 测试与独立 node 环境未设置该变量时沿用旧推断逻辑。
  const explicitPackaged = process.env.REFCANVAS_PACKAGED;
  const packaged = explicitPackaged !== undefined
    ? explicitPackaged === "1"
    : Boolean(resourcesPath && runtime.defaultApp !== true);
  if (packaged) {
    return [path.join(resourcesPath!, "app.asar.unpacked", OIIO_RELATIVE_PATH)];
  }
  return [
    runtime.override,
    path.resolve(runtime.cwd ?? process.cwd(), OIIO_RELATIVE_PATH),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export async function packagedOiiotoolPath(): Promise<string | null> {
  for (const candidate of packagedOiiotoolCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next deterministic application-owned location.
    }
  }
  return null;
}

export function fitPreviewDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("EXR_INVALID_DIMENSIONS");
  }
  if (maximumWidth <= 0 || maximumHeight <= 0) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = Math.min(
    1,
    maximumWidth / sourceWidth,
    maximumHeight / sourceHeight,
  );
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export interface OpenImageIoDecodeInput {
  inputPath: string;
  outputPath: string;
  channels: readonly string[];
  sourceWidth: number;
  sourceHeight: number;
  maximumWidth: number;
  maximumHeight: number;
  inputColorSpace?: string;
  displayTransform?: "linear-srgb" | "aces-1.3" | "aces-2.0" | "raw";
  ocioConfigPath?: string;
  /** 自定义 OCIO 配置的默认显示变换（display/view），由解码器解析注入。 */
  ocioDisplayView?: OcioDisplayView | null;
  signal?: AbortSignal;
  executable?: string;
  subimage?: number;
}

export interface OpenImageIoSubimage {
  index: number;
  name: string;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
  tileWidth: number;
  tileHeight: number;
  deep: boolean;
  format: string;
  compression: string | null;
  colorSpace: string | null;
  channels: string[];
}

export interface OcioDisplayView {
  display: string;
  view: string;
}

function parseOcioListValue(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item.length > 0);
}

function unquoteOcioName(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "");
}

const OCIO_VIEW_NAME_PATTERN =
  /^\s*-\s*!<View>\s*\{\s*name\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,\s}]+)/;
const OCIO_V2_DISPLAY_PATTERN =
  /^\s*-\s*!<Display>\s*\{\s*name\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,\s}]+)/;

/**
 * 从 OCIO 配置文本中提取「默认显示变换」（display + view）。
 *
 * 优先使用 active_displays / active_views（OCIO v1/v2 均支持）；缺失时
 * 回退到 displays 段下的第一个 display 及其第一个 view。兼容 v1
 * （"  ACES:" + "    - !<View>…"）与 v2（"- !<Display> {name, views: […]}"）
 * 两种写法。解析不出时返回 null，调用方回退到 --colorconvert 路径。
 */
export function parseOcioDisplayView(configText: string): OcioDisplayView | null {
  const activeDisplays = configText.match(/^\s*active_displays:\s*\[([^\]]*)\]/m);
  const activeViews = configText.match(/^\s*active_views:\s*\[([^\]]*)\]/m);
  const preferredDisplay = activeDisplays ? parseOcioListValue(activeDisplays[1])[0] : undefined;
  const preferredView = activeViews ? parseOcioListValue(activeViews[1])[0] : undefined;

  let firstDisplay: string | null = null;
  let firstView: string | null = null;
  let preferredDisplayView: string | null = null;
  let inDisplays = false;
  let currentDisplay: string | null = null;

  for (const line of configText.split(/\r?\n/)) {
    if (!inDisplays) {
      if (/^\s*displays:\s*$/.test(line)) inDisplays = true;
      continue;
    }
    // 到达新的顶层键说明 displays 段已结束。
    if (/^\S/.test(line)) break;
    const v2Display = line.match(OCIO_V2_DISPLAY_PATTERN);
    if (v2Display) {
      const name = unquoteOcioName(v2Display[1]);
      currentDisplay = name;
      firstDisplay ??= name;
      const inlineViews = line.match(/views\s*:\s*\[([^\]]*)\]/);
      const view = inlineViews ? parseOcioListValue(inlineViews[1])[0] : undefined;
      if (view) {
        firstView ??= view;
        if (currentDisplay === preferredDisplay) preferredDisplayView ??= view;
      }
      continue;
    }
    const viewLine = line.match(OCIO_VIEW_NAME_PATTERN);
    if (viewLine) {
      const view = unquoteOcioName(viewLine[1]);
      firstView ??= view;
      if (currentDisplay === preferredDisplay) preferredDisplayView ??= view;
      continue;
    }
    // OCIO v1：display 名是缩进的 "  Name:" 行（"- !<View>…" 已在上方处理）。
    // v2 多行写法里的 "name:"/"views:" 等键名不当作 display。
    const v1Display = line.match(/^\s+([A-Za-z0-9 _\-().]+):\s*$/);
    if (v1Display && !/^(name|views|family|description|isdata|bitdepth|allocation|allocationvars|equalitygroup|categories|encoding|searchpath|strictparsing|luma|roles)$/i.test(v1Display[1].trim())) {
      currentDisplay = v1Display[1].trim();
      firstDisplay ??= currentDisplay;
    }
  }

  if (preferredDisplay && (preferredView ?? preferredDisplayView)) {
    return { display: preferredDisplay, view: preferredView ?? preferredDisplayView! };
  }
  if (firstDisplay && (preferredView ?? firstView)) {
    return { display: firstDisplay, view: preferredView ?? firstView! };
  }
  return null;
}

const ocioDisplayViewCache = new Map<string, OcioDisplayView | null>();
const OCIO_DISPLAY_VIEW_CACHE_MAX = 16;

/**
 * 读取 OCIO 配置并解析其默认显示变换。结果按 路径 + mtime + size 缓存：
 * 序列逐帧解码时避免每帧重读整个配置文件（ACES 配置可达数百 KB）。
 * 读取或解析失败返回 null，由调用方回退到 --colorconvert 路径。
 */
export async function resolveOcioDisplayView(
  configPath: string,
  options: { signal?: AbortSignal } = {},
): Promise<OcioDisplayView | null> {
  if (options.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const info = await stat(configPath).catch(() => null);
  if (!info) return null;
  const key = `${configPath}:${info.mtimeMs}:${info.size}`;
  const cached = ocioDisplayViewCache.get(key);
  if (cached !== undefined) return cached;
  const configText = await readFile(configPath, "utf8").catch(() => "");
  const parsed = configText ? parseOcioDisplayView(configText) : null;
  ocioDisplayViewCache.set(key, parsed);
  if (ocioDisplayViewCache.size > OCIO_DISPLAY_VIEW_CACHE_MAX) {
    const oldest = ocioDisplayViewCache.keys().next().value;
    if (oldest !== undefined) ocioDisplayViewCache.delete(oldest);
  }
  return parsed;
}

export function buildOpenImageIoDecodeArgs(
  input: OpenImageIoDecodeInput,
  outputPath: string,
): string[] {
  const dimensions = fitPreviewDimensions(
    input.sourceWidth,
    input.sourceHeight,
    input.maximumWidth,
    input.maximumHeight,
  );
  const displayTransform = input.displayTransform ?? "linear-srgb";
  const sourceColorSpace = input.inputColorSpace || "linear";
  const builtInConfig = displayTransform === "aces-1.3"
    ? "ocio://cg-config-v1.0.0_aces-v1.3_ocio-v2.1"
    : displayTransform === "aces-2.0"
      ? "ocio://default"
      : undefined;
  const colorConfig = input.ocioConfigPath || builtInConfig;
  const colorTransformArgs = displayTransform === "raw"
    ? []
    : input.ocioConfigPath && input.ocioDisplayView
      // 自定义 OCIO 配置：应用配置自身的显示变换（display/view）。ACES
      // 配置的显示视图指向 "Output - sRGB" 等含 RRT+ODT 色调映射的输出
      // 空间；写死 --colorconvert … sRGB 只会命中普通 sRGB 曲线空间，
      // 画面几乎不变（「选了 ACES 配置不生效」）。
      ? [`--ociodisplay:from=${sourceColorSpace}`, input.ocioDisplayView.display, input.ocioDisplayView.view]
      // sRGB 方案自动适配：输入被解析为 ACEScg（文件头声明或显式选择）时，
      // 「sRGB 显示」走 ACES 的 RRT+ODT 映射，而不是纯 gamma 直出——
      // 保证用户直觉的「ACEScg 输入 + sRGB 显示」得到标准 ACES 观感。
      : !input.ocioConfigPath && displayTransform === "linear-srgb" && sourceColorSpace === "ACEScg"
        ? [`--ociodisplay:from=ACEScg`, "sRGB - Display", "ACES 1.0 - SDR Video"]
        : !input.ocioConfigPath && displayTransform === "aces-1.3"
          ? [`--ociodisplay:from=${sourceColorSpace}`, "sRGB - Display", "ACES 1.0 - SDR Video"]
          : !input.ocioConfigPath && displayTransform === "aces-2.0"
            ? [`--ociodisplay:from=${sourceColorSpace}`, "sRGB - Display", "ACES 2.0 - SDR 100 nits (Rec.709)"]
            : ["--colorconvert", sourceColorSpace, "sRGB"];
  return [
    ...(colorConfig ? ["--colorconfig", colorConfig] : []),
    input.inputPath,
    "--subimage",
    String(input.subimage ?? 0),
    "--flatten",
    "--ch",
    input.channels.join(","),
    ...colorTransformArgs,
    "--resize",
    `${dimensions.width}x${dimensions.height}`,
    "-d",
    "uint8",
    "-o",
    outputPath,
  ];
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function xmlValue(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1].trim()) : null;
}

function xmlAttribute(block: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(`<attrib name="${escaped}"[^>]*>([\\s\\S]*?)</attrib>`),
  );
  return match ? decodeXml(match[1].trim()) : null;
}

export function parseOpenImageIoInfoXml(xml: string): OpenImageIoSubimage[] {
  return [...xml.matchAll(/<ImageSpec\b[^>]*>([\s\S]*?)<\/ImageSpec>/g)].map(
    (match, index) => {
      const block = match[1];
      return {
        index,
        name: xmlAttribute(block, "name") ?? "",
        width: Number(xmlValue(block, "width") ?? 0),
        height: Number(xmlValue(block, "height") ?? 0),
        fullWidth: Number(xmlValue(block, "full_width") ?? 0),
        fullHeight: Number(xmlValue(block, "full_height") ?? 0),
        tileWidth: Number(xmlValue(block, "tile_width") ?? 0),
        tileHeight: Number(xmlValue(block, "tile_height") ?? 0),
        deep: xmlValue(block, "deep") === "1",
        format: xmlValue(block, "format") ?? "unknown",
        compression: xmlAttribute(block, "compression"),
        colorSpace:
          xmlAttribute(block, "oiio:ColorSpace") ??
          xmlAttribute(block, "colorSpace"),
        channels: [...block.matchAll(/<channelname>([\s\S]*?)<\/channelname>/g)]
          .map((channel) => decodeXml(channel[1].trim())),
      };
    },
  );
}

export async function probeExrWithOpenImageIo(
  filename: string,
  options: { executable?: string; signal?: AbortSignal } = {},
): Promise<OpenImageIoSubimage[]> {
  if (options.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const executable = options.executable ?? await packagedOiiotoolPath();
  if (!executable) throw new Error("OPENIMAGEIO_RUNTIME_MISSING");
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      ["-a", "--info:format=xml:verbose=1", filename],
      {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
        signal: options.signal,
      },
      (error, output, stderr) => {
        if (!error) {
          resolve(output);
          return;
        }
        reject(new Error(
          `OPENIMAGEIO_PROBE_FAILED:${stderr.trim() || error.message}`,
          { cause: error },
        ));
      },
    );
  });
  if (options.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const subimages = parseOpenImageIoInfoXml(stdout);
  if (!subimages.length || subimages.some((part) =>
    part.width <= 0 || part.height <= 0 || !part.channels.length
  )) {
    throw new Error("OPENIMAGEIO_PROBE_INVALID");
  }
  return subimages;
}

/**
 * Decode in an isolated process. OpenImageIO delegates EXR pixels to OpenEXR,
 * including DWAA/DWAB, tiled, multipart and deep storage. --flatten is a no-op
 * for ordinary images and composites deep samples for a display preview.
 */
export async function decodeExrWithOpenImageIo(
  input: OpenImageIoDecodeInput,
): Promise<{ path: string; width: number; height: number }> {
  if (!input.channels.length) throw new Error("EXR_DISPLAY_CHANNELS_MISSING");
  if (input.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const executable = input.executable ?? await packagedOiiotoolPath();
  if (!executable) throw new Error("OPENIMAGEIO_RUNTIME_MISSING");
  const dimensions = fitPreviewDimensions(
    input.sourceWidth,
    input.sourceHeight,
    input.maximumWidth,
    input.maximumHeight,
  );
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  const temporary = path.join(
    path.dirname(input.outputPath),
    `${path.basename(input.outputPath)}.${randomUUID()}.tmp.png`,
  );
  // 自定义 OCIO 配置：解析配置的默认 display/view，用 --ociodisplay 应用
  // 真正的显示变换；解析失败时回退到 --colorconvert（buildOpenImageIoDecodeArgs
  // 内部兜底），保证老配置与老行为不受影响。
  const ocioDisplayView = input.ocioConfigPath && input.displayTransform !== "raw"
    ? await resolveOcioDisplayView(input.ocioConfigPath, { signal: input.signal })
    : undefined;
  const args = buildOpenImageIoDecodeArgs({ ...input, ocioDisplayView }, temporary);
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        executable,
        args,
        {
          maxBuffer: 4 * 1024 * 1024,
          timeout: 90_000,
          windowsHide: true,
          signal: input.signal,
        },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }
          const detail = stderr.trim() || error.message;
          reject(new Error(`OPENIMAGEIO_DECODE_FAILED:${detail}`, { cause: error }));
        },
      );
    });
    if (input.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
    await rename(temporary, input.outputPath);
    return { path: input.outputPath, ...dimensions };
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export interface OcioConfigValidation {
  ok: boolean;
  detail: string | null;
}

/**
 * 用一次最小解码校验自定义 OCIO 配置：色彩空间能否解析、引用的 LUT 是否
 * 存在。缺失 LUT 的配置（如 Unreal MRQ 只导出 config.ocio 未带 luts 目录）
 * 只有在真实转换时才会报错——提前校验，让用户在 OCIO 菜单里立刻看到
 * 原因，而不是预览静默失败或整条序列卡在「正在生成 HDR 预览」。
 */
export async function validateOcioConfigWithOpenImageIo(
  configPath: string,
  options: { executable?: string; signal?: AbortSignal } = {},
): Promise<OcioConfigValidation> {
  if (options.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const executable = options.executable ?? await packagedOiiotoolPath();
  if (!executable) {
    // 无解码侧车时无法验证，按「未知」放行，交给解码期回退兜底。
    return { ok: true, detail: null };
  }
  const directory = await mkdtemp(path.join(tmpdir(), "refcanvas-ocio-"));
  const inputPath = path.join(directory, "probe.exr");
  const outputPath = path.join(directory, "probe.png");
  const run = (args: string[], timeout = 30_000): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile(
        executable,
        args,
        {
          maxBuffer: 4 * 1024 * 1024,
          timeout,
          windowsHide: true,
          signal: options.signal,
        },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }
          const detail = stderr.trim() || error.message;
          reject(new Error(detail));
        },
      );
    });
  try {
    await run([
      "--create", "4x4", "3",
      "--chnames", "R,G,B",
      "-d", "half",
      "-o", inputPath,
    ]);
    // 与真实解码路径保持一致：配置能解析出 display/view 时用
    // --ociodisplay 校验显示变换，否则回退 --colorconvert（老行为）。
    const displayView = await resolveOcioDisplayView(configPath, { signal: options.signal });
    await run([
      inputPath,
      "--colorconfig", configPath,
      ...(displayView
        ? [`--ociodisplay:from=scene_linear`, displayView.display, displayView.view]
        : ["--colorconvert", "scene_linear", "sRGB"]),
      "-d", "uint8",
      "-o", outputPath,
    ]);
    return { ok: true, detail: null };
  } catch (error) {
    if (options.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED", { cause: error });
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      detail: detail.length > 400 ? `${detail.slice(0, 400)}…` : detail,
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
