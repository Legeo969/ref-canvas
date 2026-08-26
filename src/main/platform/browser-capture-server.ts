import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Lightweight local HTTP server that lets the RefCanvas browser extension
 * send captured images from web pages into the active reference board.
 *
 * Endpoints:
 *   GET  /status   — { connected, boards, activeBoardTitle }
 *   POST /capture  — { image: base64, contentType, filename, sourceUrl } → writes temp file, notifies renderer
 *
 * Listens on 127.0.0.1 only (never exposed to the network).
 */

export interface CaptureServerDeps {
  /** Returns the userData or temp directory for writing captured files. */
  getCaptureDirectory: () => string;
  /** Returns the current board list (id + title) for the status endpoint. */
  getBoardsSummary: () => Array<{ id: string; title: string }>;
  /** Called after a captured image has been written to disk; the renderer
   *  imports it into the active board. */
  onCapture: (filePath: string, sourceUrl: string) => void;
}

export interface CaptureRequestBody {
  image: string; // base64 (without data: prefix)
  contentType?: string;
  filename: string;
  sourceUrl?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Chrome 的 Local Network Access（PNA 后继）：公共/扩展上下文请求回环
  // 地址时预检要求本响应头，否则预检直接失败——表现为扩展"突然连不上"，
  // 而同机 curl 一切正常（curl 不走预检）。对旧版浏览器无副作用。
  "Access-Control-Allow-Private-Network": "true",
};

function readBody(req: http.IncomingMessage, limitBytes = 64 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > limitBytes) {
        req.destroy();
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 200);
  return cleaned || "capture.png";
}

/**
 * 追加唯一后缀：网页图片大量重名（image.png / index.jpg），若按原始名
 * 落盘，后捕获会覆盖先捕获的文件——而资产是 linked 引用（materialize
 * 不复制源文件），旧资产会悄悄显示新图内容。每次捕获独立成文件。
 */
function uniquifyFilename(name: string): string {
  const parsed = path.parse(name);
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return `${parsed.name}-${suffix}${parsed.ext}`;
}

export function createCaptureServer(
  deps: CaptureServerDeps,
  port = 17530,
): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS preflight for browser extension fetch.
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/status") {
      try {
        const boards = deps.getBoardsSummary();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            connected: true,
            boards,
            activeBoardTitle: boards[0]?.title ?? null,
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/capture") {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body) as CaptureRequestBody;
        if (!data.image || !data.filename) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing image or filename" }));
          return;
        }

        const captureDir = deps.getCaptureDirectory();
        await mkdir(captureDir, { recursive: true });
        const filename = uniquifyFilename(sanitizeFilename(data.filename));
        const filePath = path.join(captureDir, filename);
        await writeFile(filePath, Buffer.from(data.image, "base64"));
        deps.onCapture(filePath, data.sourceUrl ?? "");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, "127.0.0.1");
  return server;
}
