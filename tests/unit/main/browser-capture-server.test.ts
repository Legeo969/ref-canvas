import http from "node:http";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCaptureServer } from "../../../src/main/platform/browser-capture-server";
import { pruneOrphanedCaptures } from "../../../src/main/services/browser-capture-maintenance";

const BASE64_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M8AAAMBAQDJZIgAAAAASUVORK5CYII=";

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
  const res = await fetch(url, init);
  return { status: res.status, json: await res.json() };
}

describe("browser-capture-server", () => {
  let server: http.Server;
  let baseUrl: string;
  let capturedFiles: Array<{ path: string; sourceUrl: string }>;

  beforeEach(async () => {
    capturedFiles = [];
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = createCaptureServer(
      {
        getCaptureDirectory: () => path.join(tmpdir(), "refcanvas-capture-test"),
        getBoardsSummary: () => [{ id: "board-1", title: "测试板" }],
        onCapture: (path, sourceUrl) => capturedFiles.push({ path, sourceUrl }),
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

  it("returns CORS headers on all responses", async () => {
    const res = await fetch(`${baseUrl}/status`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
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
