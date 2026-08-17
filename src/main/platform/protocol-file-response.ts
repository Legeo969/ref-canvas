import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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
  const stream = Readable.toWeb(createReadStream(filename, { start, end }));
  return new Response(stream as ReadableStream<Uint8Array>, {
    status: range.status === "valid" ? 206 : 200,
    headers,
  });
}
