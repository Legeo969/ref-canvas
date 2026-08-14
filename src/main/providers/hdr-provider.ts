import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  decodeExr,
  decodeRgbExr,
  decodeRgbaExr,
  init as initExrs,
  type ExrDecodeLayer,
} from "exrs";
import sharp from "sharp";
import type {
  ProviderHealth,
  ProviderMetadataInput,
  ProviderMetadataResult,
  ProviderPreviewInput,
  ProviderPreviewResult,
  ProviderProbeInput,
  ProviderProbeResult,
  ProviderThumbnailInput,
  ProviderThumbnailResult,
  ProviderWaveformInput,
  ProviderWaveformResult,
  ProviderConvertInput,
  ProviderConvertResult,
  ResourceProvider,
  ResourceProviderManifest,
} from "../../shared/worker-protocol";
import {
  deriveExrDisplayLayers,
  parseExrHeader,
  selectDefaultExrLayer,
  type ExrDisplayComponent,
  type ExrDisplayLayer,
  type ExrHeaderInfo,
} from "../services/media/exr-header";
import { parseHdrHeader } from "../services/media/hdr-header";
import { packagedFfmpegPath } from "../services/media/ffmpeg-tools";
import {
  decodeExrWithOpenImageIo,
  packagedOiiotoolPath,
  probeExrWithOpenImageIo,
  type OpenImageIoSubimage,
} from "../services/media/openimageio-tools";

const execFileAsync = promisify(execFile);
let exrsInitialization: Promise<void> | null = null;

function ensureExrsInitialized(): Promise<void> {
  exrsInitialization ??= initExrs();
  return exrsInitialization;
}

function linearToSrgbByte(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const encoded = value <= 0.0031308
    ? value * 12.92
    : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, encoded) * 255);
}

function alphaToByte(value: number): number {
  if (!Number.isFinite(value)) return 255;
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function rgbaFloatToBytes(
  pixels: Float32Array,
  channels: 1 | 3 | 4,
  signal?: AbortSignal,
): Buffer {
  const pixelCount = Math.floor(pixels.length / channels);
  const output = Buffer.allocUnsafe(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if ((pixel & 0xffff) === 0 && signal?.aborted) {
      throw new Error("PREVIEW_QUEUE_ABORTED");
    }
    const source = pixel * channels;
    const target = pixel * 4;
    if (channels === 1) {
      const value = linearToSrgbByte(pixels[source]);
      output[target] = value;
      output[target + 1] = value;
      output[target + 2] = value;
      output[target + 3] = 255;
      continue;
    }
    output[target] = linearToSrgbByte(pixels[source]);
    output[target + 1] = linearToSrgbByte(pixels[source + 1]);
    output[target + 2] = linearToSrgbByte(pixels[source + 2]);
    output[target + 3] = channels === 4 ? alphaToByte(pixels[source + 3]) : 255;
  }
  return output;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
}

async function yieldAndCheck(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  throwIfAborted(signal);
}

function temporaryPngPath(outputPath: string): string {
  return path.join(
    path.dirname(outputPath),
    `${path.basename(outputPath)}.${randomUUID()}.tmp.png`,
  );
}

async function publishTemporaryPng(
  temporary: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  await yieldAndCheck(signal);
  await rename(temporary, outputPath);
}

function findDecodedLayer(
  layers: ExrDecodeLayer[],
  name: string,
): ExrDecodeLayer | null {
  const normalized = name.trim().toLowerCase();
  return layers.find((layer) => (layer.name ?? "").trim().toLowerCase() === normalized) ?? null;
}

interface ResolvedExrSelection {
  layer: ExrDisplayLayer | null;
  component: ExrDisplayComponent | null;
  channels: string[];
  header: ExrHeaderInfo;
  subimage: number;
  subimageCount: number;
  sourceWidth: number;
  sourceHeight: number;
  colorSpace: string | null;
}

interface ExrLayerCandidate {
  part: OpenImageIoSubimage;
  layer: ExrDisplayLayer;
}

function orderedLayerChannels(layer: ExrDisplayLayer): string[] {
  return (["R", "G", "B", "A"] as ExrDisplayComponent[]).flatMap(
    (component) => {
      const suffix = `.${component}`.toLowerCase();
      const channel = layer.channels.find((name) =>
        name.toLowerCase() === `${layer.name}${suffix}`.toLowerCase() ||
        name.toLowerCase() === component.toLowerCase(),
      );
      return channel ? [channel] : [];
    },
  );
}

function layerCandidates(subimages: readonly OpenImageIoSubimage[]): ExrLayerCandidate[] {
  return subimages.flatMap((part) =>
    deriveExrDisplayLayers(part.channels.map((name) => ({ name }))).map((layer) => ({
      part,
      layer: layer.name === "" && part.name
        ? { ...layer, name: part.name }
        : layer,
    })),
  );
}

function defaultLayerCandidate(
  candidates: readonly ExrLayerCandidate[],
): ExrLayerCandidate | null {
  const layer = selectDefaultExrLayer(candidates.map((candidate) => candidate.layer));
  return candidates.find((candidate) => candidate.layer === layer) ?? null;
}

function canUseSimpleExrsFallback(
  header: ExrHeaderInfo,
  selection: Pick<ResolvedExrSelection, "subimage" | "subimageCount">,
): boolean {
  const pixels = (header.width ?? 0) * (header.height ?? 0);
  return selection.subimage === 0 &&
    selection.subimageCount === 1 &&
    !header.tiles &&
    pixels > 0 &&
    header.channels.length > 0 &&
    pixels * header.channels.length <= 64_000_000 &&
    header.compression !== "dwaa" &&
    header.compression !== "dwab";
}

function hasCanonicalChannelOrder(header: ExrHeaderInfo): boolean {
  return header.channels.every(
    (channel, index) => index === 0 ||
      header.channels[index - 1].name.localeCompare(channel.name, "en-US") <= 0,
  );
}

/**
 * HDR provider（计划 §6.2 / §9.2）：EXR 与 Radiance HDR。
 *
 * - probe/metadata：自解析文件头（尺寸、通道、压缩、位深、data/display
 *   window、chromaticities、色彩空间），不解码像素。
 * - thumbnail：libvips（sharp）读取 EXR/HDR 并执行线性 → sRGB 的
 *   display transform（tone map），输出 PNG 缩略图。
 *
 * 已知色彩转换结果（验收 15.1）：线性 0.5 灰的 EXR 应输出约 188/255
 * （0.5^(1/2.2) ≈ 0.730 → 186）；测试用 fixture 验证。
 */

interface ExrProbeCacheEntry {
  at: number;
  size: number;
  mtimeMs: number;
  subimages: OpenImageIoSubimage[];
}

/** resolveExrSelection 的进程内探测缓存：序列逐帧解码时省掉每帧一次
 *  oiiotool --info 进程启动（约 50ms）。键=路径，值随大小/mtime 失效。 */
const exrProbeCache = new Map<string, ExrProbeCacheEntry>();
const EXR_PROBE_CACHE_MAX = 64;

export const HDR_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "hdr-provider",
  version: "2.0.0",
  kinds: ["image"],
  extensions: ["exr", "hdr"],
  mimeTypes: ["image/x-exr", "image/vnd.radiance"],
  capabilities: ["probe", "metadata", "thumbnail"],
  priority: 20,
  runtime: "native-sidecar",
};

export class HdrProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = HDR_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    const runtime = await packagedOiiotoolPath();
    return runtime
      ? { ok: true, detail: "Bundled OpenImageIO/OpenEXR sidecar available" }
      : { ok: true, detail: "Simple EXR fallback available; native sidecar missing" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const extra = await this.readHeader(input.path, input.extension);
    if (!extra.valid) {
      throw new Error(`HDR_PROBE_FAILED:${extra.error ?? "UNKNOWN"}`);
    }
    return {
      width: extra.width,
      height: extra.height,
      duration: null,
      extra: {
        format: input.extension.toLowerCase(),
        channels: extra.channels,
        compression: extra.compression,
        bitDepth: extra.bitDepth,
        dataWindow: extra.dataWindow,
        displayWindow: extra.displayWindow,
        chromaticities: extra.chromaticities,
        colorSpace: extra.colorSpace,
        pixelAspectRatio: extra.pixelAspectRatio,
        layers: extra.layers,
        defaultLayer: extra.defaultLayer,
        subimages: extra.subimages,
      },
    };
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const extra = await this.readHeader(input.path, input.extension);
    if (!extra.valid) {
      throw new Error(`HDR_METADATA_FAILED:${extra.error ?? "UNKNOWN"}`);
    }
    return {
      fields: {
        format: input.extension.toUpperCase(),
        width: extra.width,
        height: extra.height,
        channels: extra.channels.map((channel) => channel.name).join(", "),
        channelCount: extra.channels.length,
        compression: extra.compression,
        bitDepth: extra.bitDepth,
        dataWindow: extra.dataWindow,
        displayWindow: extra.displayWindow,
        chromaticities: extra.chromaticities,
        colorSpace: extra.colorSpace,
        pixelAspectRatio: extra.pixelAspectRatio,
        lineOrder: extra.lineOrder,
        layers: extra.layers.map((layer) => layer.name || "Main"),
        layerCount: extra.layers.length,
        defaultLayer: extra.defaultLayer === "" ? "Main" : extra.defaultLayer,
        subimages: extra.subimages,
      },
    };
  }

  /**
   * 已知色彩转换结果（验收 15.1）：线性 0.5 灰应输出约 186-197/255
   * （近似 sRGB gamma 编码）；测试用 fixture 验证。
   */
  async thumbnail(input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    if (!input.outputPath) {
      throw new Error("HDR_THUMBNAIL_OUTPUT_MISSING");
    }
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    // EXR/HDR 解码为线性 float（gbrpf32le），gamma 2.2 编码做
    // display transform，再量化 8bit PNG。EXR/HDR 不依赖 sharp
    // 的 libvips loader（prebuilt 不含 EXR）。
    const extension = input.extension.toLowerCase();
    const ocioExecutable = input.ocioConfigPath || input.displayTransform
      ? await packagedOiiotoolPath()
      : null;
    if (extension === "hdr" && ocioExecutable) {
      const header = await parseHdrHeader(input.path);
      if (!header.valid || !header.width || !header.height) {
        throw new Error(`HDR_DECODE_FAILED:${header.error ?? "INVALID_HEADER"}`);
      }
      return decodeExrWithOpenImageIo({
        inputPath: input.path,
        outputPath: input.outputPath,
        channels: ["R", "G", "B"],
        sourceWidth: header.width,
        sourceHeight: header.height,
        maximumWidth: input.width,
        maximumHeight: input.height,
        inputColorSpace: input.inputColorSpace || header.colorSpace || "linear",
        displayTransform: input.displayTransform,
        ocioConfigPath: input.ocioConfigPath,
        signal: input.signal,
        executable: ocioExecutable,
      });
    }
    if (extension === "exr") {
      const selection = await this.resolveExrSelection(input.path, input.channel);
      const executable = await packagedOiiotoolPath();
      // OpenEXR requires alphabetically sorted channel headers. A few legacy
      // fixtures/encoders violate that rule; the bounded WASM fallback can
      // still decode those small scanline files without invoking OIIO.
      if (executable && hasCanonicalChannelOrder(selection.header)) {
        try {
          return await decodeExrWithOpenImageIo({
            inputPath: input.path,
            outputPath: input.outputPath,
            channels: selection.channels,
            sourceWidth: selection.sourceWidth,
            sourceHeight: selection.sourceHeight,
            maximumWidth: input.width,
            maximumHeight: input.height,
            inputColorSpace: input.inputColorSpace || (/acescg/i.test(selection.colorSpace ?? "")
              ? "ACEScg"
              : "linear"),
            displayTransform: input.displayTransform,
            ocioConfigPath: input.ocioConfigPath,
            signal: input.signal,
            executable,
            subimage: selection.subimage,
          });
        } catch (error) {
          if (input.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED", { cause: error });
          if (!canUseSimpleExrsFallback(selection.header, selection)) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(`EXR_DECODE_FAILED:${detail}`, { cause: error });
          }
        }
      } else if (!canUseSimpleExrsFallback(selection.header, selection)) {
        throw new Error("EXR_DECODE_FAILED:OPENIMAGEIO_RUNTIME_MISSING");
      }
      try {
        return await this.decodeExrThumbnail(
          { ...input, outputPath: input.outputPath },
          selection,
        );
      } catch (error) {
        if (String(error).includes("channel names are not sorted alphabetically")) {
          return this.decodeLegacyExrWithFfmpeg(
            { ...input, outputPath: input.outputPath },
            selection,
          );
        }
        throw error;
      }
    }
    const selection = {
      layer: null,
      component: this.standardComponent(input.channel),
    };
    if (extension !== "exr" && input.channel && !selection.component) {
      throw new Error("HDR_CHANNEL_UNSUPPORTED");
    }
    const channel = selection.component?.toLowerCase();
    const channelFilter = channel
      ? channel === "r"
        ? "format=rgba,extractplanes=r,format=gray,format=rgb24"
        : channel === "g"
          ? "format=rgba,extractplanes=g,format=gray,format=rgb24"
          : channel === "b"
            ? "format=rgba,extractplanes=b,format=gray,format=rgb24"
            : channel === "a"
              ? "format=rgba,extractplanes=a,format=gray,format=rgb24"
              : null
      : null;
    if (selection.component && !channelFilter) {
      throw new Error("HDR_CHANNEL_UNSUPPORTED");
    }
    const temporary = temporaryPngPath(input.outputPath);
    try {
      throwIfAborted(input.signal);
      await execFileAsync(
        packagedFfmpegPath(),
        [
          "-v",
          "error",
          "-i",
          input.path,
          "-vf",
          [
            `scale='min(${input.width},iw)':'min(${input.height},ih)':force_original_aspect_ratio=decrease`,
            channelFilter ?? "format=gbrpf32le",
            "eq=gamma=2.2",
            "format=rgb24",
          ].join(","),
          "-frames:v",
          "1",
          "-y",
          temporary,
        ],
        {
          maxBuffer: 16 * 1024 * 1024,
          timeout: 60_000,
          windowsHide: true,
          signal: input.signal,
        },
      );
      await publishTemporaryPng(temporary, input.outputPath, input.signal);
      return {
        path: input.outputPath,
        width: input.width,
        height: input.height,
      };
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async decodeExrThumbnail(
    input: ProviderThumbnailInput & { outputPath: string },
    selection: { layer: ExrDisplayLayer | null; component: ExrDisplayComponent | null },
  ): Promise<ProviderThumbnailResult> {
    const temporary = temporaryPngPath(input.outputPath);
    try {
      throwIfAborted(input.signal);
      await ensureExrsInitialized();
      await yieldAndCheck(input.signal);
      const bytes = await readFile(input.path);
      await yieldAndCheck(input.signal);
      let width: number;
      let height: number;
      let pixels: Float32Array;
      let channels: 1 | 3 | 4;

      const canUseFastMainLayer = selection.layer?.name === "";
      if (canUseFastMainLayer && !selection.component) {
        if (selection.layer?.components.includes("A")) {
          const decoded = decodeRgbaExr(bytes);
          width = decoded.width;
          height = decoded.height;
          pixels = decoded.interleavedRgbaPixels;
          channels = 4;
        } else {
          const decoded = decodeRgbExr(bytes);
          width = decoded.width;
          height = decoded.height;
          pixels = decoded.interleavedRgbPixels;
          channels = 3;
        }
      } else {
        const decoded = decodeExr(bytes);
        width = decoded.width;
        height = decoded.height;
        const layer = findDecodedLayer(decoded.layers, selection.layer?.name ?? "");
        if (!layer) throw new Error("EXR_DISPLAY_LAYER_NOT_FOUND");
        if (selection.component) {
          const componentPixels = layer.getInterleavedPixels([selection.component]);
          if (!componentPixels) throw new Error("HDR_CHANNEL_UNSUPPORTED");
          pixels = componentPixels;
          channels = 1;
        } else if (layer.containsChannelNames(["R", "G", "B", "A"])) {
          const rgba = layer.getInterleavedPixels(["R", "G", "B", "A"]);
          if (!rgba) throw new Error("EXR_DISPLAY_CHANNELS_MISSING");
          pixels = rgba;
          channels = 4;
        } else {
          const rgb = layer.getInterleavedPixels(["R", "G", "B"]);
          if (!rgb) throw new Error("EXR_DISPLAY_CHANNELS_MISSING");
          pixels = rgb;
          channels = 3;
        }
      }

      if (width <= 0 || height <= 0 || pixels.length < width * height * channels) {
        throw new Error("EXR_INVALID_PIXEL_BUFFER");
      }
      await yieldAndCheck(input.signal);
      const rgba = rgbaFloatToBytes(pixels, channels, input.signal);
      await yieldAndCheck(input.signal);
      const info = await sharp(rgba, {
        raw: { width, height, channels: 4 },
      })
        .resize({
          width: input.width,
          height: input.height,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toFile(temporary);
      await publishTemporaryPng(temporary, input.outputPath, input.signal);
      return {
        path: input.outputPath,
        width: info.width,
        height: info.height,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`EXR_DECODE_FAILED:${detail}`, { cause: error });
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async decodeLegacyExrWithFfmpeg(
    input: ProviderThumbnailInput & { outputPath: string },
    selection: ResolvedExrSelection,
  ): Promise<ProviderThumbnailResult> {
    const channel = selection.component?.toLowerCase();
    const channelFilter = channel
      ? channel === "r"
        ? "format=rgba,extractplanes=r,format=gray,format=rgb24"
        : channel === "g"
          ? "format=rgba,extractplanes=g,format=gray,format=rgb24"
          : channel === "b"
            ? "format=rgba,extractplanes=b,format=gray,format=rgb24"
            : channel === "a"
              ? "format=rgba,extractplanes=a,format=gray,format=rgb24"
              : null
      : null;
    const temporary = temporaryPngPath(input.outputPath);
    try {
      throwIfAborted(input.signal);
      await execFileAsync(
        packagedFfmpegPath(),
        [
          "-v",
          "error",
          ...(selection.layer?.name ? ["-layer", selection.layer.name] : []),
          "-i",
          input.path,
          "-vf",
          [
            `scale='min(${input.width},iw)':'min(${input.height},ih)':force_original_aspect_ratio=decrease`,
            channelFilter ?? "format=gbrpf32le",
            "eq=gamma=2.2",
            "format=rgb24",
          ].join(","),
          "-frames:v",
          "1",
          "-y",
          temporary,
        ],
        {
          maxBuffer: 16 * 1024 * 1024,
          timeout: 60_000,
          windowsHide: true,
          signal: input.signal,
        },
      );
      await publishTemporaryPng(temporary, input.outputPath, input.signal);
      return { path: input.outputPath, width: input.width, height: input.height };
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  waveform(_input: ProviderWaveformInput): Promise<ProviderWaveformResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  preview(_input: ProviderPreviewInput): Promise<ProviderPreviewResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  convert(_input: ProviderConvertInput): Promise<ProviderConvertResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  async dispose(): Promise<void> {
    // 无自有资源。
  }

  private async readHeader(
    filename: string,
    extension: string,
  ): Promise<{
    valid: boolean;
    error: string | null;
    width: number | null;
    height: number | null;
    channels: Array<{ name: string }>;
    compression: string | null;
    bitDepth: number | null;
    dataWindow: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
    displayWindow: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
    chromaticities: Record<string, number> | null;
    colorSpace: string | null;
    pixelAspectRatio: number | null;
    lineOrder: string | null;
    layers: ExrDisplayLayer[];
    defaultLayer: string | null;
    subimages: Array<{
      index: number;
      name: string;
      width: number;
      height: number;
      channels: string[];
      compression: string | null;
      tiled: boolean;
      deep: boolean;
    }>;
  }> {
    if (extension.toLowerCase() === "exr") {
      const parsed = await parseExrHeader(filename);
      const executable = await packagedOiiotoolPath();
      const topology = executable
        ? await probeExrWithOpenImageIo(filename, { executable }).catch(() => null)
        : null;
      const subimages = topology ?? (parsed.valid && parsed.width && parsed.height
        ? [{
            index: 0,
            name: "",
            width: parsed.width,
            height: parsed.height,
            fullWidth: parsed.width,
            fullHeight: parsed.height,
            tileWidth: parsed.tiles ? 1 : 0,
            tileHeight: parsed.tiles ? 1 : 0,
            deep: false,
            format: parsed.bitDepth === 16 ? "half" : "float",
            compression: parsed.compression,
            colorSpace: parsed.colorSpace,
            channels: parsed.channels.map((channel) => channel.name),
          }]
        : []);
      const candidates = layerCandidates(subimages);
      const selected = defaultLayerCandidate(candidates);
      const primaryPart = selected?.part ?? subimages[0];
      const layers = candidates.map((candidate) => ({
        ...candidate.layer,
        subimage: candidate.part.index,
        partName: candidate.part.name,
      }));
      return {
        valid: parsed.valid || subimages.length > 0,
        error: parsed.valid || subimages.length > 0 ? null : parsed.error,
        width: primaryPart?.width ?? parsed.width,
        height: primaryPart?.height ?? parsed.height,
        channels: subimages.flatMap((part) =>
          part.channels.map((name) => ({ name, subimage: part.index, partName: part.name })),
        ),
        compression: primaryPart?.compression ?? parsed.compression,
        bitDepth: primaryPart
          ? primaryPart.format === "half" ? 16 : 32
          : parsed.bitDepth,
        dataWindow: parsed.dataWindow,
        displayWindow: parsed.displayWindow,
        chromaticities: parsed.chromaticities,
        colorSpace: primaryPart?.colorSpace ?? parsed.colorSpace,
        pixelAspectRatio: parsed.pixelAspectRatio,
        lineOrder: parsed.lineOrder,
        layers,
        defaultLayer: selected?.layer.name ?? null,
        subimages: subimages.map((part) => ({
          index: part.index,
          name: part.name,
          width: part.width,
          height: part.height,
          channels: part.channels,
          compression: part.compression,
          tiled: part.tileWidth > 0 && part.tileHeight > 0,
          deep: part.deep,
        })),
      };
    }
    const parsed = await parseHdrHeader(filename);
    return {
      valid: parsed.valid,
      error: parsed.error,
      width: parsed.width,
      height: parsed.height,
      channels: [],
      compression: parsed.format,
      bitDepth: 32,
      dataWindow: null,
      displayWindow: null,
      chromaticities: null,
      colorSpace: parsed.colorSpace,
      pixelAspectRatio: null,
      lineOrder: null,
      layers: [],
      defaultLayer: null,
      subimages: [],
    };
  }

  private standardComponent(channel: string | undefined): ExrDisplayComponent | null {
    const normalized = channel?.trim().toUpperCase();
    return normalized === "R" || normalized === "G" || normalized === "B" || normalized === "A"
      ? normalized
      : null;
  }

  private async resolveExrSelection(
    filename: string,
    requested: string | undefined,
  ): Promise<ResolvedExrSelection> {
    const header = await parseExrHeader(filename);
    if (!header.valid) {
      throw new Error(`HDR_THUMBNAIL_FAILED:${header.error ?? "UNKNOWN"}`);
    }
    const executable = await packagedOiiotoolPath();
    // 序列逐帧解码时，每个 thumbnail 调用都会重新探测同一文件的
    // subimage/通道结构（一次 oiiotool --info 进程 + ~50ms）。按
    // 路径+大小+mtime 做进程内 LRU，帧图结构不变时直接复用。
    const info = await stat(filename).catch(() => null);
    const probeCacheKey = filename;
    const probeCached = info
      ? exrProbeCache.get(probeCacheKey)
      : undefined;
    const probed = executable
      ? probeCached && probeCached.size === info!.size && probeCached.mtimeMs === info!.mtimeMs
        ? probeCached.subimages
        : await probeExrWithOpenImageIo(filename, { executable }).catch(() => null)
      : null;
    if (probed && info) {
      exrProbeCache.set(probeCacheKey, {
        size: info.size,
        mtimeMs: info.mtimeMs,
        at: Date.now(),
        subimages: probed,
      });
      if (exrProbeCache.size > EXR_PROBE_CACHE_MAX) {
        const oldest = [...exrProbeCache.entries()]
          .sort((left, right) => left[1].at - right[1].at)[0]?.[0];
        if (oldest) exrProbeCache.delete(oldest);
      }
    }
    const subimages: OpenImageIoSubimage[] = probed ?? [{
      index: 0,
      name: "",
      width: header.width ?? 0,
      height: header.height ?? 0,
      fullWidth: header.width ?? 0,
      fullHeight: header.height ?? 0,
      tileWidth: header.tiles ? 1 : 0,
      tileHeight: header.tiles ? 1 : 0,
      deep: false,
      format: header.bitDepth === 16 ? "half" : "float",
      compression: header.compression,
      colorSpace: header.colorSpace,
      channels: header.channels.map((channel) => channel.name),
    }];
    const candidates = layerCandidates(subimages);
    const defaultCandidate = defaultLayerCandidate(candidates);

    const resolved = (
      part: OpenImageIoSubimage,
      layer: ExrDisplayLayer | null,
      component: ExrDisplayComponent | null,
      channels: string[],
    ): ResolvedExrSelection => ({
      layer,
      component,
      channels,
      header,
      subimage: part.index,
      subimageCount: subimages.length,
      sourceWidth: part.width,
      sourceHeight: part.height,
      colorSpace: part.colorSpace ?? header.colorSpace,
    });

    if (!requested) {
      if (!defaultCandidate) throw new Error("EXR_DISPLAY_LAYER_NOT_FOUND");
      return resolved(
        defaultCandidate.part,
        defaultCandidate.layer,
        null,
        orderedLayerChannels(defaultCandidate.layer),
      );
    }

    const normalized = requested.trim().toLowerCase();
    const requestedLayer = candidates.find(
      (candidate) => candidate.layer.name.toLowerCase() === normalized,
    );
    if (requestedLayer) {
      return resolved(
        requestedLayer.part,
        requestedLayer.layer,
        null,
        orderedLayerChannels(requestedLayer.layer),
      );
    }

    for (const candidate of candidates) {
      const prefix = candidate.layer.name
        ? `${candidate.layer.name}.`.toLowerCase()
        : "";
      if (!prefix || !normalized.startsWith(prefix)) continue;
      const component = this.standardComponent(requested.slice(prefix.length));
      if (!component || !candidate.layer.components.includes(component)) continue;
      const rawChannel = orderedLayerChannels(candidate.layer)[
        candidate.layer.components.indexOf(component)
      ];
      if (rawChannel) {
        return resolved(candidate.part, candidate.layer, component, [rawChannel]);
      }
    }

    const orderedParts = defaultCandidate
      ? [defaultCandidate.part, ...subimages.filter((part) => part !== defaultCandidate.part)]
      : subimages;
    let part: OpenImageIoSubimage | null = null;
    let rawChannel: string | null = null;
    for (const candidatePart of orderedParts) {
      const match = candidatePart.channels.find(
        (channel) => channel.toLowerCase() === normalized,
      );
      if (match) {
        part = candidatePart;
        rawChannel = match;
        break;
      }
    }
    if (!part || !rawChannel) throw new Error("HDR_CHANNEL_UNSUPPORTED");
    const separator = rawChannel.lastIndexOf(".");
    const layerName = separator >= 0 ? rawChannel.slice(0, separator) : "";
    const component = this.standardComponent(
      separator >= 0 ? rawChannel.slice(separator + 1) : rawChannel,
    );
    const matchingCandidate = candidates.find((candidate) =>
      candidate.part === part && (
        candidate.layer.name === layerName ||
        candidate.layer.channels.includes(rawChannel!)
      )
    );
    return resolved(
      part,
      matchingCandidate?.layer ?? {
        name: layerName || part.name,
        channels: [rawChannel],
        components: component ? [component] : [],
      },
      component,
      [rawChannel],
    );
  }
}
