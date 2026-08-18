import { mkdir } from "node:fs/promises";
import path from "node:path";
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
import { parseFontFile } from "../services/media/sfnt";

/**
 * 字体 provider（阶段 4：专业格式 — 字体）。
 *
 * TTF/OTF/WOFF/WOFF2/TTC：probe/metadata 用自研 SFNT 解析器
 * （family、style、weight、italic、unitsPerEm、glyph 数、可变轴）；
 * thumbnail 生成"样张"SVG（Aa 大字符 + 字族名 + 样式），由 sharp
 * 渲染为 PNG（浏览器样张由 renderer 用 FontFace 加载真实字体）。
 */

export const FONT_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "font-provider",
  version: "1.0.0",
  kinds: ["font"],
  extensions: ["ttf", "otf", "woff", "woff2", "ttc"],
  mimeTypes: ["font/*"],
  capabilities: ["probe", "metadata", "thumbnail"],
  priority: 20,
  runtime: "node",
};

export class FontProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = FONT_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "built-in SFNT parser available" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const info = await parseFontFile(input.path);
    if (!info.valid) {
      throw new Error(`FONT_PROBE_FAILED:${info.error ?? "UNKNOWN"}`);
    }
    return {
      width: null,
      height: null,
      duration: null,
      extra: {
        format: "font",
        flavor: info.flavor,
        family: info.family,
        subfamily: info.subfamily,
        weightClass: info.weightClass,
        italic: info.italic,
        unitsPerEm: info.unitsPerEm,
        glyphCount: info.glyphCount,
        variableAxes: info.variableAxes,
      },
    };
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const info = await parseFontFile(input.path);
    if (!info.valid) {
      throw new Error(`FONT_METADATA_FAILED:${info.error ?? "UNKNOWN"}`);
    }
    return {
      fields: {
        flavor: info.flavor,
        family: info.family,
        subfamily: info.subfamily,
        postscriptName: info.postscriptName,
        weightClass: info.weightClass,
        weightName: weightName(info.weightClass),
        italic: info.italic,
        unitsPerEm: info.unitsPerEm,
        glyphCount: info.glyphCount,
        variableAxes: info.variableAxes.map((axis) => ({
          tag: axis.tag,
          name: axis.name,
          min: axis.minValue,
          default: axis.defaultValue,
          max: axis.maxValue,
        })),
      },
    };
  }

  async thumbnail(input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    if (!input.outputPath) {
      throw new Error("FONT_THUMBNAIL_OUTPUT_MISSING");
    }
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    const info = await parseFontFile(input.path);
    const svg = fontSpecimenSvg(
      info,
      input.width,
      input.height,
      input.extension,
    );
    const sharp = (await import("sharp")).default;
    await sharp(Buffer.from(svg)).webp({ quality: 85 }).toFile(input.outputPath);
    return { path: input.outputPath, width: input.width, height: input.height };
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
}

function weightName(weight: number | null): string | null {
  if (weight == null) return null;
  if (weight < 150) return "Thin";
  if (weight < 250) return "ExtraLight";
  if (weight < 350) return "Light";
  if (weight < 450) return "Regular";
  if (weight < 550) return "Medium";
  if (weight < 650) return "SemiBold";
  if (weight < 750) return "Bold";
  if (weight < 850) return "ExtraBold";
  return "Black";
}

function flavorLabel(flavor: string | null): string {
  if (!flavor) return "";
  if (flavor === "\u0000\u0001\u0000\u0000") return "TrueType";
  if (flavor === "OTTO") return "OpenType (CFF)";
  if (flavor === "true") return "Apple TrueType";
  if (flavor === "typ1") return "PostScript";
  return flavor;
}

/** 字体样张 SVG（占位缩略图；真实字形样张在 renderer 用 FontFace）。 */
export function fontSpecimenSvg(
  info: Awaited<ReturnType<typeof parseFontFile>>,
  width: number,
  height: number,
  extension: string,
): string {
  const family = info.family ?? info.postscriptName ?? extension.toUpperCase();
  const styleParts: string[] = [];
  if (info.weightClass != null) styleParts.push(weightName(info.weightClass) ?? String(info.weightClass));
  if (info.italic) styleParts.push("Italic");
  const axes =
    info.variableAxes.length > 0
      ? ` · 可变: ${info.variableAxes.map((axis) => axis.tag).join(" ")}`
      : "";
  const escaped = family
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .split("")
    .map((character) => (character.charCodeAt(0) < 0x20 && character !== "\t" ? "" : character))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#1a1f1d"/>
  <text x="24" y="52" font-family="Segoe UI, sans-serif" font-size="13" fill="#8d9a94">${extension.toUpperCase()} · ${flavorLabel(info.flavor)}</text>
  <text x="24" y="${height * 0.62}" font-family="Georgia, 'Times New Roman', serif" font-size="${Math.floor(height * 0.5)}" font-weight="${info.weightClass ?? 400}" font-style="${info.italic ? "italic" : "normal"}" fill="#dce4df">Aa</text>
  <text x="24" y="${height - 58}" font-family="Segoe UI, sans-serif" font-size="17" font-weight="600" fill="#c8d1cc">${escaped}</text>
  <text x="24" y="${height - 34}" font-family="Segoe UI, sans-serif" font-size="13" fill="#8d9a94">${styleParts.join(" ") || "Regular"}${axes}</text>
  <text x="24" y="${height - 14}" font-family="Segoe UI, sans-serif" font-size="12" fill="#6b7670">${info.glyphCount ?? "?"} glyphs</text>
</svg>`;
}
