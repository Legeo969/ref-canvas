import { open } from "node:fs/promises";
import path from "node:path";

// Multi-channel renders (especially Unreal/OCIO output) can carry thousands
// of channel and custom attributes. A 4 KiB prefix truncates valid headers
// before dataWindow, making the inspector look empty even though the file is
// readable. Keep the read bounded while covering production headers.
const EXR_HEADER_BYTES = 1024 * 1024;

/**
 * EXR（OpenEXR）头解析（阶段 3 §9.2）。
 *
 * 只解析头部与通道信息，不解码像素：probe/metadata 需要的数据
 * （尺寸、通道、压缩、位深、data/display window、chromaticities）
 * 全部在 header 中。像素级 tone mapping 交给 thumbnail 管线。
 */

export interface ExrChannel {
  name: string;
  /** 0 = uint, 1 = half, 2 = float。 */
  pixelType: 0 | 1 | 2;
  xSampling: number;
  ySampling: number;
}

export type ExrDisplayComponent = "R" | "G" | "B" | "A";

export interface ExrDisplayLayer {
  /** 空字符串表示未命名的顶层 R/G/B(/A) 通道。 */
  name: string;
  channels: string[];
  components: ExrDisplayComponent[];
}

export interface ExrHeaderInfo {
  /** 文件是否可解析为 EXR。 */
  valid: boolean;
  error: string | null;
  width: number | null;
  height: number | null;
  channels: ExrChannel[];
  compression: string | null;
  /** 每通道位数（half=16，float=32，uint=32）。 */
  bitDepth: number | null;
  dataWindow: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
  displayWindow: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
  pixelAspectRatio: number | null;
  chromaticities: { redX: number; redY: number; greenX: number; greenY: number; blueX: number; blueY: number; whiteX: number; whiteY: number } | null;
  lineOrder: string | null;
  /** 打包在文件中的自有颜色空间描述（如 "ACEScg"、"Rec.709"）。 */
  colorSpace: string | null;
  tiles: boolean;
}

const COMPRESSION_NAMES: Record<number, string> = {
  0: "none",
  1: "rle",
  2: "zips",
  3: "zip",
  4: "piz",
  5: "pxr24",
  6: "b44",
  7: "b44a",
  8: "dwaa",
  9: "dwab",
};

const DISPLAY_COMPONENTS = new Set<ExrDisplayComponent>(["R", "G", "B", "A"]);
const AUXILIARY_LAYER_PATTERN =
  /(?:motionvectors?|worlddepth|hitproxy|depth|velocity|cryptomatte|stencil|objectid|materialid|worldnormal|normal|mask\d*)/i;

function splitDisplayChannel(name: string): {
  layer: string;
  component: ExrDisplayComponent;
} | null {
  const separator = name.lastIndexOf(".");
  const layer = separator >= 0 ? name.slice(0, separator) : "";
  const component = (separator >= 0 ? name.slice(separator + 1) : name).toUpperCase();
  if (!DISPLAY_COMPONENTS.has(component as ExrDisplayComponent)) return null;
  return { layer, component: component as ExrDisplayComponent };
}

/** 将 raw channels 归并为可合成预览的完整 RGB layers。 */
export function deriveExrDisplayLayers(
  channels: ReadonlyArray<Pick<ExrChannel, "name">>,
): ExrDisplayLayer[] {
  const grouped = new Map<
    string,
    { channels: string[]; components: Set<ExrDisplayComponent> }
  >();
  for (const channel of channels) {
    const parsed = splitDisplayChannel(channel.name);
    if (!parsed) continue;
    const group = grouped.get(parsed.layer) ?? {
      channels: [],
      components: new Set<ExrDisplayComponent>(),
    };
    group.channels.push(channel.name);
    group.components.add(parsed.component);
    grouped.set(parsed.layer, group);
  }
  return Array.from(grouped, ([name, group]) => ({
    name,
    channels: group.channels,
    components: (["R", "G", "B", "A"] as ExrDisplayComponent[]).filter(
      (component) => group.components.has(component),
    ),
  })).filter(
    (layer) =>
      layer.components.includes("R") &&
      layer.components.includes("G") &&
      layer.components.includes("B"),
  );
}

/** 选择默认 Beauty/Final Image，辅助 render pass 永不作为主图。 */
export function selectDefaultExrLayer(
  layers: readonly ExrDisplayLayer[],
): ExrDisplayLayer | null {
  let selected: ExrDisplayLayer | null = null;
  let selectedScore = -1;
  for (const layer of layers) {
    if (AUXILIARY_LAYER_PATTERN.test(layer.name)) continue;
    const score = layer.name === ""
      ? 500
      : /finalimage/i.test(layer.name) && /beauty|main|combined|rgba/i.test(layer.name)
        ? 450
        : /beauty/i.test(layer.name)
          ? 400
          : /finalimage/i.test(layer.name)
            ? 350
            : /combined|rgba/i.test(layer.name)
              ? 300
              : 200;
    if (score > selectedScore) {
      selected = layer;
      selectedScore = score;
    }
  }
  return selected;
}

function readCString(
  buffer: Buffer,
  offset: number,
  limit: number,
): { value: string; next: number } | null {
  const end = buffer.indexOf(0, offset);
  if (end < 0 || end >= limit) return null;
  return { value: buffer.toString("utf8", offset, end), next: end + 1 };
}

function readInt32LE(buffer: Buffer, offset: number): number {
  return buffer.readInt32LE(offset);
}

function readFloatLE(buffer: Buffer, offset: number): number {
  return buffer.readFloatLE(offset);
}

/**
 * 从序列首帧解析默认显示层（Beauty/Final Image）。非 EXR 返回 null；
 * 解析失败返回 null，调用方按无层处理（ffmpeg 默认读取顶层通道）。
 */
export async function defaultExrLayer(files: string[]): Promise<string | null> {
  if (path.extname(files[0] ?? "").toLowerCase() !== ".exr") return null;
  const header = await parseExrHeader(files[0]);
  if (!header.valid) return null;
  return selectDefaultExrLayer(deriveExrDisplayLayers(header.channels))?.name ?? null;
}

/**
 * 解析 EXR 文件头。返回头信息；像素数据不读取。
 * 头部截断（畸形文件）时返回 valid=false 与错误描述。
 */
export async function parseExrHeader(
  filename: string,
): Promise<ExrHeaderInfo> {
  const info: ExrHeaderInfo = {
    valid: false,
    error: null,
    width: null,
    height: null,
    channels: [],
    compression: null,
    bitDepth: null,
    dataWindow: null,
    displayWindow: null,
    pixelAspectRatio: null,
    chromaticities: null,
    lineOrder: null,
    colorSpace: null,
    tiles: false,
  };
  const handle = await open(filename, "r");
  try {
    const header = Buffer.alloc(EXR_HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const view = header.subarray(0, bytesRead);
    if (bytesRead < 8) {
      info.error = "EXR_HEADER_TOO_SHORT";
      return info;
    }
    const magic = view.readUInt32LE(0);
    if (magic !== 0x01312f76) {
      info.error = "EXR_MAGIC_MISMATCH";
      return info;
    }
    const version = view.readUInt32LE(4);
    const versionNumber = version & 0xff;
    if (versionNumber !== 2) {
      info.error = "EXR_UNSUPPORTED_VERSION";
      return info;
    }
    info.tiles = Boolean(version & (1 << 9));

    // 逐 attribute 解析，遇到空 attribute（name 长度 0）结束。
    let offset = 8;
    const end = view.length;
    let maxDepth = 200;
    while (offset < end && maxDepth-- > 0) {
      const name = readCString(view, offset, end);
      if (!name) {
        info.error = "EXR_HEADER_TRUNCATED";
        return info;
      }
      offset = name.next;
      if (name.value.length === 0) break; // 空 attribute = header 结束
      const type = readCString(view, offset, end);
      if (!type) {
        info.error = "EXR_HEADER_TRUNCATED";
        return info;
      }
      offset = type.next;
      if (offset + 4 > end) {
        info.error = "EXR_HEADER_TRUNCATED";
        return info;
      }
      const size = readInt32LE(view, offset);
      offset += 4;
      if (size < 0 || offset + size > end) {
        info.error = "EXR_ATTRIBUTE_OUT_OF_BOUNDS";
        return info;
      }
      const value = view.subarray(offset, offset + size);
      offset += size;

      switch (name.value) {
        case "channels": {
          let channelOffset = 0;
          while (channelOffset < value.length) {
            const channelName = readCString(value, channelOffset, value.length);
            if (!channelName) break;
            channelOffset = channelName.next;
            if (channelName.value.length === 0) break;
            if (channelOffset + 4 > value.length) break;
            const pixelType = value.readInt32LE(channelOffset) as 0 | 1 | 2;
            channelOffset += 4;
            channelOffset += 4; // pLinear(1) + reserved(3)
            if (channelOffset + 8 > value.length) break;
            const xSampling = value.readInt32LE(channelOffset);
            const ySampling = value.readInt32LE(channelOffset + 4);
            channelOffset += 8;
            info.channels.push({
              name: channelName.value,
              pixelType,
              xSampling,
              ySampling,
            });
          }
          break;
        }
        case "compression": {
          const code = value[0] ?? 0;
          info.compression = COMPRESSION_NAMES[code] ?? `unknown(${code})`;
          break;
        }
        case "dataWindow": {
          if (value.length >= 16) {
            info.dataWindow = {
              xMin: value.readInt32LE(0),
              yMin: value.readInt32LE(4),
              xMax: value.readInt32LE(8),
              yMax: value.readInt32LE(12),
            };
          }
          break;
        }
        case "displayWindow": {
          if (value.length >= 16) {
            info.displayWindow = {
              xMin: value.readInt32LE(0),
              yMin: value.readInt32LE(4),
              xMax: value.readInt32LE(8),
              yMax: value.readInt32LE(12),
            };
          }
          break;
        }
        case "pixelAspectRatio": {
          if (value.length >= 4) info.pixelAspectRatio = readFloatLE(value, 0);
          break;
        }
        case "chromaticities": {
          if (value.length >= 32) {
            info.chromaticities = {
              redX: readFloatLE(value, 0),
              redY: readFloatLE(value, 4),
              greenX: readFloatLE(value, 8),
              greenY: readFloatLE(value, 12),
              blueX: readFloatLE(value, 16),
              blueY: readFloatLE(value, 20),
              whiteX: readFloatLE(value, 24),
              whiteY: readFloatLE(value, 28),
            };
          }
          break;
        }
        case "lineOrder": {
          info.lineOrder = value[0] === 1 ? "decreasing-y" : "increasing-y";
          break;
        }
        case "colorSpace": {
          info.colorSpace = value.toString("utf8").replace(/\0+$/, "");
          break;
        }
        default:
          break;
      }
    }

    if (!info.dataWindow) {
      info.error = "EXR_MISSING_DATA_WINDOW";
      return info;
    }
    info.width = info.dataWindow.xMax - info.dataWindow.xMin + 1;
    info.height = info.dataWindow.yMax - info.dataWindow.yMin + 1;
    const primary = info.channels.find(
      (channel) => channel.pixelType !== 0,
    ) ?? info.channels[0];
    info.bitDepth = primary
      ? primary.pixelType === 1
        ? 16
        : 32
      : null;
    info.valid = info.width > 0 && info.height > 0;
    if (!info.valid) info.error = "EXR_INVALID_DIMENSIONS";
    return info;
  } finally {
    await handle.close();
  }
}
