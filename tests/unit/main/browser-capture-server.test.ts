import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCaptureServer } from "../../../src/main/platform/browser-capture-server";

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
    expect(capturedFiles[0].path).toContain("test-capture.png");
    expect(capturedFiles[0].sourceUrl).toBe("https://example.com/page.html");
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
