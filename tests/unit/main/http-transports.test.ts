/**
 * HTTP transport 生产实现测试（FND-009/010 运行时接线）。
 *
 * 注入确定性 fetchFn + 假 DNS，验证：
 * - Comfy fetchJson/uploadImage/downloadBuffer 与超限保护。
 * - Remote request 重定向策略（Job API 0 次、预签名 1 次）、重定向目标
 *   公网校验、下载限长与 MIME/sha256 元数据。
 * - 网络错误与超时映射为稳定错误码。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpComfyTransport,
  HttpRemoteTransport,
} from "../../../src/main/services/ai/http-transports";
import { COMFYUI_DEFAULT_ADDRESS } from "../../../src/main/services/ai/comfyui-provider";

const publicDns = async () => ["93.184.216.34"]; // 校验用公网 IP（不真实连接）。

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function redirectResponse(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } });
}

describe("HttpComfyTransport (FND-009)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches JSON endpoints and uploads images", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/system_stats")) {
          return jsonResponse(200, { system: { comfyui_version: "0.3.5" } });
        }
        if (url.endsWith("/upload/image")) {
          return jsonResponse(200, { name: "ref.png", type: "input" });
        }
        return jsonResponse(404, { error: "not found" });
      },
    );
    const transport = new HttpComfyTransport("http://127.0.0.1:8188", fetchMock as typeof fetch);
    const stats = await transport.fetchJson("/system_stats");
    expect(stats.status).toBe(200);
    expect(
      (stats.body as { system?: { comfyui_version?: string } }).system?.comfyui_version,
    ).toBe("0.3.5");
    const uploaded = await transport.uploadImage("ref.png", Buffer.from("image-bytes"));
    expect(uploaded.name).toBe("ref.png");
    // 上传请求是 multipart（body 为 FormData）。
    const uploadCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/upload/image"));
    expect(uploadCall?.[1]?.body).toBeInstanceOf(FormData);
  });

  it("rejects oversized downloads", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array(64).fill(1), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    );
    const transport = new HttpComfyTransport("http://127.0.0.1:8188", fetchMock as typeof fetch);
    const buffer = await transport.downloadBuffer("http://127.0.0.1:8188/view?filename=x.png", 128);
    expect(buffer).not.toBeNull();
    expect(buffer!.length).toBe(64);
    const tooLarge = await transport.downloadBuffer("http://127.0.0.1:8188/view?filename=x.png", 32);
    expect(tooLarge).toBeNull();
  });

  it("maps network errors to stable codes", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const transport = new HttpComfyTransport("http://127.0.0.1:8188", fetchMock as typeof fetch);
    await expect(transport.fetchJson("/system_stats")).rejects.toThrow("COMFYUI_NETWORK_ERROR");
  });
});

describe("HttpRemoteTransport (FND-010)", () => {
  it("forbids redirects on Job API calls", async () => {
    const fetchMock = vi.fn(async () => redirectResponse(307, "https://example.com/evil"));
    const transport = new HttpRemoteTransport(fetchMock as typeof fetch, publicDns);
    await expect(
      transport.request({
        method: "POST",
        url: "https://api.example.com/v1/design-jobs",
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("REMOTE_REDIRECT_REJECTED");
  });

  it("allows exactly one HTTPS redirect for presigned requests", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/presign")) {
        return redirectResponse(302, "https://cdn.example.com/target");
      }
      return jsonResponse(200, { ok: true });
    });
    const transport = new HttpRemoteTransport(fetchMock as typeof fetch, publicDns);
    const response = await transport.request({
      method: "PUT",
      url: "https://api.example.com/presign",
      maxRedirects: 1,
      timeoutMs: 5_000,
    });
    expect(response.status).toBe(200);
    expect((response.body as { ok?: boolean }).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a second redirect", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("/b")
        ? redirectResponse(302, "https://cdn.example.com/c")
        : redirectResponse(302, "https://cdn.example.com/b");
    });
    const transport = new HttpRemoteTransport(fetchMock as typeof fetch, publicDns);
    await expect(
      transport.request({
        method: "GET",
        url: "https://api.example.com/a",
        maxRedirects: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/REMOTE_REDIRECT/);
  });

  it("rejects redirect targets that resolve to private addresses", async () => {
    const fetchMock = vi.fn(async () =>
      redirectResponse(302, "https://cdn.example.com/target"),
    );
    const privateDns = async () => ["127.0.0.1"];
    const transport = new HttpRemoteTransport(fetchMock as typeof fetch, privateDns);
    await expect(
      transport.request({
        method: "PUT",
        url: "https://api.example.com/presign",
        maxRedirects: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("REMOTE_REDIRECT_TARGET_REJECTED");
  });

  it("downloads with size caps and mime metadata", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array(8).fill(2), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    );
    const transport = new HttpRemoteTransport(fetchMock as typeof fetch, publicDns);
    const result = await transport.download({
      url: "https://cdn.example.com/out.png",
      headers: {},
      maxBytes: 64,
      timeoutMs: 5_000,
    });
    expect(result).not.toBeNull();
    expect(result!.mime).toBe("image/png");
    expect(result!.buffer.length).toBe(8);
    expect(result!.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      transport.download({
        url: "https://cdn.example.com/out.png",
        headers: {},
        maxBytes: 4,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("REMOTE_DOWNLOAD_TOO_LARGE");
  });

  it("rejects downloads redirected to private targets", async () => {
    const fetchMock = vi.fn(async () =>
      redirectResponse(302, "https://cdn.example.com/private"),
    );
    const privateDns = async () => ["10.0.0.5"];
    const transport = new HttpRemoteTransport(fetchMock as typeof fetch, privateDns);
    await expect(
      transport.download({
        url: "https://cdn.example.com/out.png",
        headers: {},
        maxBytes: 1024,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("REMOTE_DOWNLOAD_REDIRECT_REJECTED");
  });
});

describe("HttpComfyTransport default address", () => {
  it("exposes the documented default", () => {
    expect(COMFYUI_DEFAULT_ADDRESS).toBe("http://127.0.0.1:8188");
  });
});
