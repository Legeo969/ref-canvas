import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import type { CapturePairingResult } from "../services/browser-capture-pairing-service";
import { isBrowserExtensionOrigin } from "../services/browser-capture-pairing-service";

const MAX_REQUEST_BYTES = 48 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 100_000_000;
const EXTENSION_ID_HEADER = "x-refcanvas-extension-id";
const IMAGE_FORMATS = new Map<string, { contentType: string; extension: string }>([
  ["png", { contentType: "image/png", extension: ".png" }],
  ["jpeg", { contentType: "image/jpeg", extension: ".jpg" }],
  ["webp", { contentType: "image/webp", extension: ".webp" }],
  ["gif", { contentType: "image/gif", extension: ".gif" }],
  ["avif", { contentType: "image/avif", extension: ".avif" }],
  // SVG is rasterized before writing so captured markup cannot be rendered as
  // active content when it is later previewed by the desktop app.
  ["svg", { contentType: "image/png", extension: ".png" }],
]);

export interface CaptureMeta {
  sourceUrl: string;
  boardId?: string;
  pageTitle?: string;
  alt?: string;
}

export interface CaptureServerDeps {
  getCaptureDirectory: () => string;
  getBoardsSummary: () => Array<{ id: string; title: string }>;
  onCapture: (filePath: string, meta: CaptureMeta) => void;
  pair: (code: string, origin: string, label?: string) => CapturePairingResult;
  authenticate: (origin: string, token: string) => boolean;
}

export interface CaptureRequestBody {
  image: string;
  contentType?: string;
  filename: string;
  sourceUrl?: string;
  boardId?: string;
  pageTitle?: string;
  alt?: string;
}

function readBody(req: http.IncomingMessage, limitBytes = MAX_REQUEST_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > limitBytes) {
        req.destroy();
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function requestOrigin(req: http.IncomingMessage): string {
  const value = req.headers.origin;
  return typeof value === "string" ? value : "";
}

function extensionId(req: http.IncomingMessage): string {
  const value = req.headers[EXTENSION_ID_HEADER];
  return typeof value === "string" && /^[a-p]{32}$/.test(value) ? value : "";
}

/**
 * Chromium may omit Origin for extension service-worker requests covered by
 * host_permissions. The extension therefore sends its runtime id explicitly.
 * If a browser Origin is present it remains authoritative, so a regular web
 * page cannot impersonate an extension by adding the custom header.
 */
function extensionOrigin(req: http.IncomingMessage): string {
  const rawOrigin = requestOrigin(req).trim().replace(/\/$/, "");
  const claimedId = extensionId(req);
  const claimedOrigin = claimedId ? `chrome-extension://${claimedId}` : "";
  if (rawOrigin && rawOrigin !== "null") {
    if (!isBrowserExtensionOrigin(rawOrigin)) return "";
    if (claimedOrigin && claimedOrigin !== rawOrigin) return "";
    return rawOrigin;
  }
  return claimedOrigin;
}

function bearerToken(req: http.IncomingMessage): string {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string") return "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{40,})$/.exec(authorization);
  return match?.[1] ?? "";
}

function applyCors(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin: string,
): boolean {
  if (!isBrowserExtensionOrigin(origin)) return false;
  const browserOrigin = requestOrigin(req).trim();
  if (browserOrigin && browserOrigin !== "null") {
    res.setHeader("Access-Control-Allow-Origin", browserOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-RefCanvas-Extension-Id",
  );
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  return true;
}

function sanitizeFilename(name: string): string {
  // Control characters and Windows-reserved filename characters are removed.
  // eslint-disable-next-line no-control-regex
  const cleaned = path.basename(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180);
  return cleaned || "capture";
}

function uniqueFilename(name: string, extension: string): string {
  const base = path.parse(sanitizeFilename(name)).name.slice(0, 160) || "capture";
  return `${base}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}${extension}`;
}

function decodeBase64Image(value: string): Buffer {
  if (!value || value.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) {
    throw new Error("IMAGE_TOO_LARGE");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("INVALID_IMAGE_ENCODING");
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("IMAGE_TOO_LARGE");
  }
  return buffer;
}

async function validateImage(
  buffer: Buffer,
): Promise<{ buffer: Buffer; extension: string; contentType: string }> {
  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, {
      animated: true,
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: "error",
    }).metadata();
  } catch {
    throw new Error("UNSUPPORTED_IMAGE_FORMAT");
  }
  const format = metadata.format ? IMAGE_FORMATS.get(metadata.format) : undefined;
  const pages = metadata.pages ?? 1;
  if (
    !format ||
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height * pages > MAX_IMAGE_PIXELS
  ) {
    throw new Error("IMAGE_DIMENSIONS_TOO_LARGE");
  }
  if (metadata.format === "svg") {
    try {
      const rasterized = await sharp(buffer, {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: "error",
      })
        .png()
        .toBuffer();
      if (rasterized.length > MAX_IMAGE_BYTES) {
        throw new Error("IMAGE_TOO_LARGE");
      }
      return { ...format, buffer: rasterized };
    } catch (error) {
      if (error instanceof Error && error.message === "IMAGE_TOO_LARGE") throw error;
      throw new Error("UNSUPPORTED_IMAGE_FORMAT", { cause: error });
    }
  }
  return { ...format, buffer };
}

function statusForError(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("PAIRING_CODE_")) return 401;
  if (
    message === "PAIRING_ORIGIN_REJECTED" ||
    message === "INVALID_IMAGE_ENCODING" ||
    message === "UNSUPPORTED_IMAGE_FORMAT" ||
    message === "IMAGE_DIMENSIONS_TOO_LARGE" ||
    message === "IMAGE_TOO_LARGE"
  ) return 400;
  if (message === "PAYLOAD_TOO_LARGE") return 413;
  return 500;
}

export function createCaptureServer(deps: CaptureServerDeps, port = 17530): http.Server {
  const server = http.createServer(async (req, res) => {
    const origin = extensionOrigin(req);
    if (!applyCors(req, res, origin)) {
      sendJson(res, 403, { error: "EXTENSION_ORIGIN_REQUIRED" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/pair") {
      try {
        const data = JSON.parse(await readBody(req, 8 * 1024)) as { code?: string; label?: string };
        sendJson(res, 200, deps.pair(data.code ?? "", origin, data.label));
      } catch (error) {
        sendJson(res, statusForError(error), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (!deps.authenticate(origin, bearerToken(req))) {
      sendJson(res, 401, { error: "PAIRING_REQUIRED" });
      return;
    }

    if (req.method === "GET" && req.url === "/status") {
      try {
        const boards = deps.getBoardsSummary();
        sendJson(res, 200, {
          connected: true,
          boards,
          activeBoardTitle: boards[0]?.title ?? null,
        });
      } catch (error) {
        sendJson(res, 500, { error: String(error) });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/capture") {
      let temporaryPath: string | null = null;
      try {
        const data = JSON.parse(await readBody(req)) as CaptureRequestBody;
        if (!data.image || !data.filename) {
          sendJson(res, 400, { error: "Missing image or filename" });
          return;
        }
        if (
          data.boardId !== undefined &&
          !deps.getBoardsSummary().some((board) => board.id === data.boardId)
        ) {
          sendJson(res, 400, { error: "目标板不存在或已被删除" });
          return;
        }

        const buffer = decodeBase64Image(data.image);
        const image = await validateImage(buffer);
        const captureDirectory = deps.getCaptureDirectory();
        await mkdir(captureDirectory, { recursive: true });
        const filename = uniqueFilename(data.filename, image.extension);
        const filePath = path.join(captureDirectory, filename);
        temporaryPath = path.join(captureDirectory, `.${filename}.${randomUUID()}.tmp`);
        await writeFile(temporaryPath, image.buffer, { flag: "wx" });
        await rename(temporaryPath, filePath);
        temporaryPath = null;
        deps.onCapture(filePath, {
          sourceUrl: data.sourceUrl ?? "",
          boardId: data.boardId,
          pageTitle: data.pageTitle,
          alt: data.alt,
        });
        sendJson(res, 200, { ok: true });
      } catch (error) {
        if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
        sendJson(res, statusForError(error), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  server.listen(port, "127.0.0.1");
  return server;
}
