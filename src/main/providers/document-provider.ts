import { open } from "node:fs/promises";
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

/**
 * 文档 provider（阶段 4：专业格式 — 文档）。
 *
 * - 文本类（txt/md/rtf/srt/json/yaml…）：读取头部采样，统计行数/
 *   字符数/首行预览；thumbnail 生成文本卡片 SVG。
 * - PDF/Office（pdf/doc/docx/xls/xlsx/ppt/pptx/odt/ods/odp）：
 *   无捆绑渲染器（不静默依赖本机 Office/PDF 库），probe 返回
 *   unsupportedReason 明确降级；thumbnail 不支持 → 占位 fallback。
 */

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "rtf", "srt", "vtt", "json", "yaml", "yml",
  "xml", "csv", "tsv", "log", "ini", "cfg", "toml", "conf", "html", "htm",
  "css", "js", "ts", "tsx", "jsx", "py", "sh", "bat", "ps1", "reg",
  "glsl", "hlsl", "vert", "frag", "comp",
]);

const OFFICE_EXTENSIONS: Record<string, string> = {
  pdf: "PDF：本地无渲染器（无 poppler），不静默依赖系统组件",
  doc: "Word 97-2003：无本地渲染器",
  docx: "Word：无本地渲染器",
  xls: "Excel 97-2003：无本地渲染器",
  xlsx: "Excel：无本地渲染器",
  ppt: "PowerPoint 97-2003：无本地渲染器",
  pptx: "PowerPoint：无本地渲染器",
  odt: "OpenDocument 文本：无本地渲染器",
  ods: "OpenDocument 表格：无本地渲染器",
  odp: "OpenDocument 演示：无本地渲染器",
  epub: "EPUB：无本地渲染器",
};

const READABLE_OFFICE_EXTENSIONS = new Set(["docx", "xlsx", "pptx"]);

export const DOCUMENT_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "document-provider",
  version: "1.0.0",
  kinds: ["generic", "pdf"],
  extensions: [...TEXT_EXTENSIONS, ...Object.keys(OFFICE_EXTENSIONS)],
  mimeTypes: [],
  capabilities: ["probe", "metadata", "thumbnail"],
  priority: 20,
  runtime: "node",
};

interface TextSample {
  lineCount: number | null;
  charCount: number | null;
  firstLine: string | null;
  encoding: string | null;
}

async function sampleText(filename: string, limit = 65536): Promise<TextSample | null> {
  try {
    const file = await open(filename, "r");
    try {
      const buffer = Buffer.alloc(limit);
      const { bytesRead } = await file.read(buffer, 0, limit, 0);
      const data = buffer.subarray(0, bytesRead);
      // 二进制探测：前 8KB 中 NUL 比例 > 1% 视为二进制。
      const probeLength = Math.min(bytesRead, 8192);
      let nullCount = 0;
      for (let i = 0; i < probeLength; i += 1) {
        if (data[i] === 0) nullCount += 1;
      }
      if (nullCount > probeLength / 100) {
        return null;
      }
      // UTF-8 编码探测：无 BOM 时尝试严格解码，失败回退 latin1。
      let encoding = "utf-8";
      let text: string;
      try {
        text = data.toString("utf8");
        // 检测替换字符数量判断是否真的 UTF-8。
        const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
        if (replacementCount > Math.max(1, text.length / 64)) {
          throw new Error("not utf8");
        }
      } catch {
        encoding = "latin1";
        text = data.toString("latin1");
      }
      if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
        encoding = "utf-8 (BOM)";
      }
      const lines = text.split(/\r\n|\n|\r/);
      const firstLine =
        lines.find((line) => line.trim().length > 0)?.slice(0, 200) ?? null;
      return {
        lineCount: lines.length,
        charCount: text.length,
        firstLine,
        encoding,
      };
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

export class DocumentProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = DOCUMENT_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "text sampler available" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const extension = input.extension.toLowerCase();
    if (OFFICE_EXTENSIONS[extension]) {
      return {
        width: null,
        height: null,
        duration: null,
        extra: {
          format: extension,
          ...(READABLE_OFFICE_EXTENSIONS.has(extension)
            ? { previewMode: "extracted-text" }
            : { unsupportedReason: OFFICE_EXTENSIONS[extension] }),
        },
      };
    }
    if (TEXT_EXTENSIONS.has(extension)) {
      const sample = await sampleText(input.path);
      if (!sample) {
        throw new Error("DOCUMENT_PROBE_FAILED:READ_FAILED");
      }
      return {
        width: null,
        height: null,
        duration: null,
        extra: {
          format: "text",
          encoding: sample.encoding,
          lineCount: sample.lineCount,
          charCount: sample.charCount,
          firstLine: sample.firstLine,
        },
      };
    }
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const extension = input.extension.toLowerCase();
    if (OFFICE_EXTENSIONS[extension]) {
      return {
        fields: { format: extension.toUpperCase(), note: OFFICE_EXTENSIONS[extension] },
      };
    }
    const sample = await sampleText(input.path);
    if (!sample) {
      throw new Error("DOCUMENT_METADATA_FAILED:READ_FAILED");
    }
    return {
      fields: {
        format: "TEXT",
        encoding: sample.encoding,
        lineCount: sample.lineCount,
        charCount: sample.charCount,
        firstLine: sample.firstLine,
      },
    };
  }

  async thumbnail(input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    const extension = input.extension.toLowerCase();
    if (OFFICE_EXTENSIONS[extension]) {
      throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
    }
    if (!TEXT_EXTENSIONS.has(extension)) {
      throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
    }
    if (!input.outputPath) {
      throw new Error("DOCUMENT_THUMBNAIL_OUTPUT_MISSING");
    }
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    const sample = await sampleText(input.path);
    const svg = textCardSvg(
      sample,
      input.width,
      input.height,
      extension,
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

/** 文本卡片 SVG 缩略图：首行 + 行数/字符数。 */
export function textCardSvg(
  sample: TextSample | null,
  width: number,
  height: number,
  extension: string,
): string {
  const lines: string[] = [];
  const escaped = (value: string): string =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .slice(0, 90);
  if (sample?.firstLine) {
    for (const chunk of sample.firstLine.match(/.{1,22}/g) ?? []) {
      lines.push(
        `<text x="20" y="${46 + lines.length * 22}" font-family="Consolas, monospace" font-size="13" fill="#c8d1cc">${escaped(chunk)}</text>`,
      );
      if (lines.length >= 5) break;
    }
  } else {
    lines.push(
      `<text x="20" y="50" font-family="Segoe UI, sans-serif" font-size="13" fill="#8d9a94">（空文件）</text>`,
    );
  }
  const meta = sample
    ? `${sample.lineCount} 行 · ${sample.charCount} 字符 · ${sample.encoding ?? "?"}`
    : "文本";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#151a18"/>
  <text x="20" y="24" font-family="Segoe UI, sans-serif" font-size="12" fill="#8d9a94">${extension.toUpperCase()} · ${meta}</text>
  ${lines.join("")}
</svg>`;
}
