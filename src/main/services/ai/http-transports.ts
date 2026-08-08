/**
 * 生产 HTTP transport（found-clone.md §9.5 / §9.6）。
 *
 * - {@link HttpComfyTransport}：ComfyUI 本地服务的 fetch/upload/download。
 * - {@link HttpRemoteTransport}：Remote REST v1 的 HTTPS 传输层。
 *
 * 安全约束：
 * - Job API 请求默认禁止重定向（maxRedirects 缺省 0）。
 * - 预签名请求最多一次重定向，每次重定向目标重新执行公网 HTTPS 校验。
 * - 下载受 maxBytes 限制（Content-Length 与实际字节双重校验）。
 * - 网络/超时错误统一映射为稳定错误码，不泄漏 URL 细节以外的信息。
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { URL } from "node:url";
import type {
  ComfyHttpResponse,
  ComfyTransport,
  ComfyUploadResult,
} from "./comfyui-provider";
import type {
  RemoteDownloadResult,
  RemoteHttpResponse,
  RemoteTransport,
} from "./remote-ai-provider";
import { validateRedirectTarget } from "./remote-ai-security";

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

type ResolveDns = (hostname: string) => Promise<string[]>;

const defaultResolveDns: ResolveDns = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((address) => address.address);
};

function networkError(prefix: "COMFYUI" | "REMOTE", cause: unknown): Error {
  const name =
    cause instanceof Error && cause.name === "TimeoutError"
      ? `${prefix}_TIMEOUT`
      : `${prefix}_NETWORK_ERROR`;
  return new Error(name);
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** ComfyUI 本地服务 transport（真实 HTTP）。 */
export class HttpComfyTransport implements ComfyTransport {
  constructor(
    private readonly address: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async fetchJson(
    pathname: string,
    init?: { method?: string; body?: unknown },
  ): Promise<ComfyHttpResponse> {
    try {
      const response = await this.fetchFn(`${this.address}${pathname}`, {
        method: init?.method ?? "GET",
        headers: init?.body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
        body:
          init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      });
      return {
        status: response.status,
        headers: normalizeHeaders(response.headers),
        body: await parseJsonBody(response),
      };
    } catch (error) {
      throw networkError("COMFYUI", error);
    }
  }

  async uploadImage(
    filename: string,
    fileBuffer: Buffer,
  ): Promise<ComfyUploadResult> {
    try {
      const form = new FormData();
      form.append("image", new Blob([new Uint8Array(fileBuffer)]), filename);
      const response = await this.fetchFn(`${this.address}/upload/image`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      });
      const body = (await parseJsonBody(response)) as {
        name?: string;
        subfolder?: string;
        type?: string;
      };
      if (!body?.name) throw new Error("COMFYUI_UPLOAD_NAME_MISSING");
      return {
        name: body.name,
        subfolder: body.subfolder,
        type: body.type,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("COMFYUI_")) {
        throw error;
      }
      throw networkError("COMFYUI", error);
    }
  }

  async downloadBuffer(url: string, maxBytes: number): Promise<Buffer | null> {
    try {
      const response = await this.fetchFn(url, {
        signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) return null;
      const array = await response.arrayBuffer();
      if (array.byteLength > maxBytes) return null;
      return Buffer.from(array);
    } catch (error) {
      throw networkError("COMFYUI", error);
    }
  }

  async close(): Promise<void> {
    // 无持久连接；no-op。
  }
}

/** Remote REST v1 传输层（真实 HTTPS）。 */
export class HttpRemoteTransport implements RemoteTransport {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly resolveDns: ResolveDns = defaultResolveDns,
  ) {}

  async request(options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyBuffer?: Buffer;
    maxRedirects?: number;
    timeoutMs: number;
  }): Promise<RemoteHttpResponse> {
    const maxRedirects = options.maxRedirects ?? 0;
    let currentUrl = options.url;
    let redirects = 0;
    for (;;) {
      const response = await this.fetchOnce(currentUrl, options, redirects > 0);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("REMOTE_REDIRECT_WITHOUT_LOCATION");
        if (redirects >= maxRedirects) {
          throw new Error("REMOTE_REDIRECT_REJECTED");
        }
        // 重定向目标重新执行公网 HTTPS 校验。
        const next = new URL(location, currentUrl).toString();
        const validation = await validateRedirectTarget(
          next,
          this.resolveDns,
        );
        if (!validation.ok) {
          throw new Error("REMOTE_REDIRECT_TARGET_REJECTED");
        }
        currentUrl = next;
        redirects += 1;
        continue;
      }
      return {
        status: response.status,
        headers: normalizeHeaders(response.headers),
        body: await parseJsonBody(response),
      };
    }
  }

  private async fetchOnce(
    url: string,
    options: {
      method: string;
      headers?: Record<string, string>;
      body?: unknown;
      bodyBuffer?: Buffer;
      timeoutMs: number;
    },
    redirected: boolean,
  ): Promise<Response> {
    try {
      return await this.fetchFn(url, {
        method: options.method,
        headers: options.headers,
        body:
          options.bodyBuffer !== undefined
            ? new Uint8Array(options.bodyBuffer)
            : options.body !== undefined
              ? JSON.stringify(options.body)
              : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(
          Math.min(options.timeoutMs, 600_000),
        ),
      });
    } catch (error) {
      if (redirected) throw networkError("REMOTE", error);
      throw networkError("REMOTE", error);
    }
  }

  async download(options: {
    url: string;
    headers?: Record<string, string>;
    maxBytes: number;
    timeoutMs: number;
  }): Promise<RemoteDownloadResult | null> {
    try {
      const response = await this.fetchFn(options.url, {
        method: "GET",
        headers: options.headers,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(options.timeoutMs, 600_000)),
      });
      if (response.status >= 300 && response.status < 400) {
        // 预签名下载允许一次 HTTPS 重定向并重新校验目标。
        const location = response.headers.get("location");
        if (!location) return null;
        const next = new URL(location, options.url).toString();
        const validation = await validateRedirectTarget(next, this.resolveDns);
        if (!validation.ok) throw new Error("REMOTE_DOWNLOAD_REDIRECT_REJECTED");
        const followed = await this.fetchFn(next, {
          method: "GET",
          headers: options.headers,
          signal: AbortSignal.timeout(Math.min(options.timeoutMs, 600_000)),
        });
        return await this.collectDownload(followed, options.maxBytes);
      }
      if (!response.ok) return null;
      return await this.collectDownload(response, options.maxBytes);
    } catch (error) {
      // 稳定错误码（限长/重定向校验）原样穿透；其余映射为网络错误。
      if (error instanceof Error && error.message.startsWith("REMOTE_")) {
        throw error;
      }
      throw networkError("REMOTE", error);
    }
  }

  private async collectDownload(
    response: Response,
    maxBytes: number,
  ): Promise<RemoteDownloadResult> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error("REMOTE_DOWNLOAD_TOO_LARGE");
    }
    const array = await response.arrayBuffer();
    if (array.byteLength > maxBytes) {
      throw new Error("REMOTE_DOWNLOAD_TOO_LARGE");
    }
    const buffer = Buffer.from(array);
    const mime = response.headers.get("content-type")?.split(";")[0] ?? "";
    return {
      buffer,
      mime,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    };
  }
}
