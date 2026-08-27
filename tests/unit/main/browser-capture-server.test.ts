import http from "node:http";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CaptureMeta } from "../../../src/main/platform/browser-capture-server";
import { createCaptureServer } from "../../../src/main/platform/browser-capture-server";
import { pruneOrphanedCaptures } from "../../../src/main/services/browser-capture-maintenance";

const BASE64_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M8AAAMBAQDJZIgAAAAASUVORK5CYII=";
const BASE64_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="#3ab28f"/></svg>',
).toString("base64");
const EXTENSION_ORIGIN = `chrome-extension://${"a".repeat(32)}`;
const EXTENSION_ID = "a".repeat(32);
const TOKEN = "x".repeat(43);

function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; json: unknown }> {
  const headers = new Headers(init?.headers);
  headers.set("Origin", EXTENSION_ORIGIN);
  headers.set("Authorization", `Bearer ${TOKEN}`);
  const res = await fetch(url, { ...init, headers });
  return { status: res.status, json: await res.json() };
}

describe("browser-capture-server", () => {
  let server: http.Server;
  let baseUrl: string;
  let capturedFiles: Array<{ path: string } & CaptureMeta>;

  beforeEach(async () => {
    capturedFiles = [];
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = createCaptureServer(
      {
        getCaptureDirectory: () => path.join(tmpdir(), "refcanvas-capture-test"),
        getBoardsSummary: () => [{ id: "board-1", title: "测试板" }],
        onCapture: (path, meta) => capturedFiles.push({ path, ...meta }),
        pair: () => ({
          token: TOKEN,
          pairing: {
            id: "pairing-1",
            origin: EXTENSION_ORIGIN,
            label: "测试浏览器",
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
          },
        }),
        authenticate: (origin, token) =>
          origin === EXTENSION_ORIGIN && token === TOKEN,
      },
      port,
    );
    // Wait until listening.
    await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns board summary and connection status on GET /status", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/status`);
    expect(status).toBe(200);
    expect(json).toEqual({
      connected: true,
      boards: [{ id: "board-1", title: "测试板" }],
      activeBoardTitle: "测试板",
    });
  });

  it("writes captured image and calls onCapture on POST /capture", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: BASE64_PNG,
        contentType: "image/png",
        filename: "test-capture.png",
        sourceUrl: "https://example.com/page.html",
      }),
    });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(capturedFiles).toHaveLength(1);
    expect(capturedFiles[0].path).toContain("test-capture");
    expect(capturedFiles[0].path).toMatch(/\.png$/);
    expect(capturedFiles[0].sourceUrl).toBe("https://example.com/page.html");
  });

  it("rasterizes SVG captures to safe PNG files", async () => {
    const { status } = await fetchJson(`${baseUrl}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: BASE64_SVG,
        contentType: "image/svg+xml",
        filename: "vector.svg",
      }),
    });
    expect(status).toBe(200);
    expect(capturedFiles).toHaveLength(1);
    expect(capturedFiles[0].path).toMatch(/\.png$/);
  });

  // 回归：网页图片大量重名（image.png / index.jpg），若按原始名落盘，
  // 后捕获会覆盖先捕获的文件——资产是 linked 引用，旧资产会悄悄显示
  // 新图内容。每次捕获必须独立成文件。
  it("never overwrites earlier captures with the same filename", async () => {
    const post = () =>
      fetchJson(`${baseUrl}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: BASE64_PNG,
          contentType: "image/png",
          filename: "image.png",
        }),
      });
    await post();
    // 同毫秒内连发两次也要唯一：后缀含随机段。
    await post();
    expect(capturedFiles).toHaveLength(2);
    const [first, second] = capturedFiles;
    expect(first.path).not.toBe(second.path);
    for (const file of capturedFiles) {
      const info = await stat(file.path);
      expect(info.isFile()).toBe(true);
    }
  });

  it("returns 400 when image or filename is missing", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: BASE64_PNG }),
    });
    expect(status).toBe(400);
    expect(json).toEqual({ error: "Missing image or filename" });
  });

  // 选板投放：boardId 必须真实存在，无效直接 400——静默落到别的板会让
  // 用户以为投成功了；扩展据此提示"默认板已被删除"。
  it("rejects captures targeting an unknown board with 400", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: BASE64_PNG,
        filename: "gone.png",
        boardId: "board-deleted",
      }),
    });
    expect(status).toBe(400);
    expect(json).toEqual({ error: "目标板不存在或已被删除" });
    expect(capturedFiles).toHaveLength(0);
  });

  it("passes board/page-title/alt metadata through to onCapture", async () => {
    const { status } = await fetchJson(`${baseUrl}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: BASE64_PNG,
        filename: "meta.png",
        sourceUrl: "https://example.com/gallery",
        boardId: "board-1",
        pageTitle: "设计灵感集",
        alt: "一张参考图",
      }),
    });
    expect(status).toBe(200);
    expect(capturedFiles).toHaveLength(1);
    const { path: filePath, ...meta } = capturedFiles[0];
    expect(filePath).toContain("meta");
    expect(meta).toEqual({
      sourceUrl: "https://example.com/gallery",
      boardId: "board-1",
      pageTitle: "设计灵感集",
      alt: "一张参考图",
    });
  });

  it("omits optional metadata when the request carries none", async () => {
    await fetchJson(`${baseUrl}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: BASE64_PNG, filename: "bare.png" }),
    });
    expect(capturedFiles[0]).toMatchObject({ sourceUrl: "" });
    expect(capturedFiles[0].boardId).toBeUndefined();
    expect(capturedFiles[0].pageTitle).toBeUndefined();
    expect(capturedFiles[0].alt).toBeUndefined();
  });

  it("returns CORS headers on all responses", async () => {
    const res = await fetch(`${baseUrl}/status`, {
      headers: { Origin: EXTENSION_ORIGIN, Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "X-RefCanvas-Extension-Id",
    );
  });

  it("accepts an authenticated extension request when Chromium omits Origin", async () => {
    const res = await fetch(`${baseUrl}/status`, {
      headers: {
        "X-RefCanvas-Extension-Id": EXTENSION_ID,
        Authorization: `Bearer ${TOKEN}`,
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true });
  });

  // 回归：Chrome 的 Local Network Access（PNA 后继）要求"更公开上下文 → 回环
  // 地址"的预检响应携带 Allow-Private-Network，否则扩展 POST /capture 的
  // 预检被浏览器直接拒绝——表现为弹窗"已连接"、同机 curl 一切正常，但
  // 捕获图片永远到不了服务器。
  it("answers the LNA preflight with Access-Control-Allow-Private-Network", async () => {
    const res = await fetch(`${baseUrl}/capture`, {
      method: "OPTIONS",
      headers: {
        Origin: EXTENSION_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
    expect(res.headers.get("access-control-allow-private-network")).toBe("true");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/unknown`, {
      headers: { Origin: EXTENSION_ORIGIN, Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it("rejects unpaired, revoked, and web-origin requests", async () => {
    const noToken = await fetch(`${baseUrl}/status`, {
      headers: { Origin: EXTENSION_ORIGIN },
    });
    expect(noToken.status).toBe(401);

    const wrongToken = await fetch(`${baseUrl}/status`, {
      headers: { Origin: EXTENSION_ORIGIN, Authorization: `Bearer ${"y".repeat(43)}` },
    });
    expect(wrongToken.status).toBe(401);

    const webOrigin = await fetch(`${baseUrl}/status`, {
      headers: {
        Origin: "https://example.com",
        "X-RefCanvas-Extension-Id": EXTENSION_ID,
        Authorization: `Bearer ${TOKEN}`,
      },
    });
    expect(webOrigin.status).toBe(403);
    expect(webOrigin.headers.get("access-control-allow-origin")).toBeNull();

    const mismatchedIdentity = await fetch(`${baseUrl}/status`, {
      headers: {
        Origin: EXTENSION_ORIGIN,
        "X-RefCanvas-Extension-Id": "b".repeat(32),
        Authorization: `Bearer ${TOKEN}`,
      },
    });
    expect(mismatchedIdentity.status).toBe(403);
  });

  it("rejects non-image payloads before writing", async () => {
    const { status } = await fetchJson(`${baseUrl}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: Buffer.from("not an image").toString("base64"),
        filename: "fake.png",
      }),
    });
    expect(status).toBe(400);
    expect(capturedFiles).toHaveLength(0);
  });
});

describe("pruneOrphanedCaptures", () => {
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  async function makeCaptureRoot() {
    return mkdtemp(path.join(tmpdir(), "refcanvas-prune-test-"));
  }

  async function writeCapture(root: string, name: string, mtime: Date) {
    const filePath = path.join(root, name);
    await writeFile(filePath, "x");
    await utimes(filePath, mtime, mtime);
    return filePath;
  }

  it("removes expired orphans, keeps referenced files and fresh files", async () => {
    const root = await makeCaptureRoot();
    try {
      const referencedOld = await writeCapture(root, "linked.png", old);
      const orphanOld = await writeCapture(root, "orphan.png", old);
      const orphanFresh = await writeCapture(
        root,
        "in-flight.png",
        new Date(),
      );
      const result = await pruneOrphanedCaptures({
        directory: root,
        hasAssetAtPath: (filePath) => filePath === referencedOld,
        now: Date.now(),
      });
      expect(result.removed.map((entry) => entry.path)).toEqual([orphanOld]);
      expect(result.kept).toBe(2);
      // 引用中的旧文件必须原样保留（linked 资产的磁盘真相）。
      await expect(stat(referencedOld)).resolves.toBeTruthy();
      await expect(stat(orphanFresh)).resolves.toBeTruthy();
      await expect(stat(orphanOld)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tolerates a missing directory", async () => {
    const result = await pruneOrphanedCaptures({
      directory: path.join(tmpdir(), `refcanvas-prune-missing-${Date.now()}`),
      hasAssetAtPath: () => false,
    });
    expect(result.removed).toEqual([]);
    expect(result.kept).toBe(0);
  });

  it("ignores subdirectories", async () => {
    const root = await makeCaptureRoot();
    try {
      const result = await pruneOrphanedCaptures({
        directory: root,
        hasAssetAtPath: () => false,
        maxAgeMs: -1,
      });
      // 目录本身不是文件，不计入 removed/kept。
      expect(result.removed).toEqual([]);
      expect(result.kept).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
