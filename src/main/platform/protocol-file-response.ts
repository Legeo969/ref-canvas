import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export type ParsedByteRange =
  | { status: "none" }
  | { status: "valid"; start: number; end: number }
  | { status: "invalid" };

export function parseByteRange(
  header: string | null,
  size: number,
): ParsedByteRange {
  if (!header) return { status: "none" };
  if (size <= 0 || header.includes(",")) return { status: "invalid" };
  // HTTP Range 解析是纯算术（正则匹配 + Number），不产生进程调用、shell
  // 执行或文件系统写入；结果只用于 createReadStream 的字节偏移。
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return { status: "invalid" };
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { status: "invalid" };
    return { status: "valid", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return { status: "invalid" };
  }
  return { status: "valid", start, end: Math.min(requestedEnd, size - 1) };
}

function contentType(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".m3u8": return "application/vnd.apple.mpegurl";
    case ".ts": return "video/mp2t";
    case ".mov": return "video/quicktime";
    case ".webm": return "video/webm";
    case ".mkv": return "video/x-matroska";
    case ".avi": return "video/x-msvideo";
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".flac": return "audio/flac";
    case ".ogg": return "audio/ogg";
    case ".m4a": return "audio/mp4";
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".bmp": return "image/bmp";
    case ".tif":
    case ".tiff": return "image/tiff";
    case ".glb": return "model/gltf-binary";
    case ".gltf": return "model/gltf+json";
    default: return "application/octet-stream";
  }
}

/**
 * 图片必须整包缓冲返回：refasset/refbrowse 均以 `stream: true` 特权注册，
 * Chromium 的图像解码器遇到 streaming body 时对大型 GIF 可能只拿到首帧
 * （</img> 停在第一帧、ImageDecoder 只报 1 帧）。缓冲后 Content-Length
 * 精确、body 完整，解码器可看到全部 165 帧。视频/音频仍走流式（range 拖动）。
 */
const IMAGE_CONTENT_TYPES = new Set([
  "image/gif",
  "image/png",
  "image/webp",
  "image/jpeg",
  "image/avif",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
]);
/** 超过此体积不再整包缓冲（防内存峰值），退回流式。 */
const MAX_BUFFERED_IMAGE_BYTES = 64 * 1024 * 1024;

export async function fileProtocolResponse(
  filename: string,
  request: Pick<Request, "method" | "headers">,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", ...extraHeaders },
    });
  }
  const info = await stat(filename);
  if (!info.isFile()) return new Response("Not found", { status: 404 });
  const range = parseByteRange(request.headers.get("range"), info.size);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": contentType(filename),
    ...extraHeaders,
  });
  if (range.status === "invalid") {
    headers.set("Content-Range", `bytes */${info.size}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  const start = range.status === "valid" ? range.start : 0;
  const end = range.status === "valid" ? range.end : Math.max(0, info.size - 1);
  const length = info.size === 0 ? 0 : end - start + 1;
  headers.set("Content-Length", String(length));
  if (range.status === "valid") {
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
  }
  if (method === "HEAD" || info.size === 0) {
    return new Response(null, {
      status: range.status === "valid" ? 206 : 200,
      headers,
    });
  }
  const isImage = IMAGE_CONTENT_TYPES.has(contentType(filename));
  if (isImage && info.size <= MAX_BUFFERED_IMAGE_BYTES) {
    // 图片已在体积上限内整包读入内存，按 range 切出目标片段的拷贝。
    const buffer = await readFile(filename);
    const slice = buffer.subarray(start, end + 1);
    return new Response(new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength), {
      status: range.status === "valid" ? 206 : 200,
      headers,
    });
  }
  const stream = Readable.toWeb(createReadStream(filename, { start, end }));
  return new Response(stream as ReadableStream<Uint8Array>, {
    status: range.status === "valid" ? 206 : 200,
    headers,
  });
}
