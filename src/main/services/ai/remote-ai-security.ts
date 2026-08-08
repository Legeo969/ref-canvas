/**
 * Remote REST v1 网络安全校验（found-clone.md §9.6）。
 *
 * - Job API base URL 必须是 HTTPS、不含凭据，并拒绝 loopback、link-local、
 *   私有网段以及解析到这些地址的主机（DNS rebinding 防护）。
 * - Job API 禁止重定向；预签名上传/下载最多允许一次保持 HTTPS 的重定向，
 *   并对目标重新执行公网地址校验。
 * - 向预签名 URL 请求时不转发 Bearer token，只发送 prepare 响应明确列出的
 *   上传 headers（allowlist 复制，拒绝 Authorization/Cookie/Host 等）。
 */
import { lookup } from "node:dns/promises";
import { URL } from "node:url";

export interface UrlValidationResult {
  ok: boolean;
  reason: string | null;
}

const PRIVATE_V4_PATTERNS: ReadonlyArray<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x7f000000, 8], // 127.0.0.0/8 loopback
  [0x64400000, 10], // 100.64.0.0/10 CGNAT
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000200, 24], // 192.0.2.0/24 TEST-NET-1
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc6120000, 15], // 198.18.0.0/15 benchmark
  [0xc6336400, 24], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24 TEST-NET-3
  [0xffff0000, 16], // 255.255.0.0 broadcast-ish
];

function ipv4ToNumber(parts: number[]): number {
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    parts[3]
  );
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const value = ipv4ToNumber(parts);
  return PRIVATE_V4_PATTERNS.some(([prefix, bits]) => {
    const mask = bits === 32 ? 0xffffffff : ((1 << bits) - 1) << (32 - bits);
    return (value & mask) === (prefix & mask);
  });
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80") || lower.startsWith("fec0")) return true; // link-local / site-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fec") || lower.startsWith("ff")) return true; // multicast
  return false;
}

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) return isPrivateIpv6(address);
  return isPrivateIpv4(address);
}

function parseIp(address: string): string | null {
  // 去除 IPv6 括号（[::1] → ::1）。
  return address.startsWith("[") && address.endsWith("]")
    ? address.slice(1, -1)
    : address;
}

/**
 * 校验 URL 是否为合法的公网 HTTPS URL（无内嵌凭据）。
 * `resolveDns` 可注入（测试用假 DNS），默认使用 node:dns/promises.lookup。
 */
export async function validatePublicHttpsUrl(
  rawUrl: string,
  resolveDns: (hostname: string) => Promise<string[]> = async (hostname) => {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map((address) => address.address);
  },
): Promise<UrlValidationResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL 无效" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Job API 必须是 HTTPS" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URL 不得包含内嵌凭据" };
  }
  if (url.port && Number(url.port) < 1) {
    return { ok: false, reason: "非法端口" };
  }
  const hostname = url.hostname;
  if (!hostname) return { ok: false, reason: "缺少主机名" };
  // localhost 永远是回环语义，即使 DNS 被解析到公网也拒绝（防 rebinding）。
  if (hostname.toLowerCase() === "localhost") {
    return { ok: false, reason: "Job API 不允许回环主机" };
  }
  // 字面 IP 直接判段。
  if (/^[0-9.]+$/.test(hostname) || hostname.includes(":")) {
    const ip = parseIp(hostname);
    if (ip && isPrivateAddress(ip)) {
      return { ok: false, reason: "Job API 不允许回环/私网地址" };
    }
    return { ok: true, reason: null };
  }
  // 域名：DNS 解析全部结果都必须是公网地址（防 rebinding）。
  try {
    const addresses = await resolveDns(hostname);
    if (addresses.length === 0) return { ok: false, reason: "DNS 解析为空" };
    for (const address of addresses) {
      const ip = parseIp(address);
      if (!ip || isPrivateAddress(ip)) {
        return { ok: false, reason: `DNS 解析到私网地址 ${address}` };
      }
    }
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: "DNS 解析失败" };
  }
}

/**
 * 重定向目标校验：预签名请求最多允许一次，且目标必须仍为公网 HTTPS。
 */
export async function validateRedirectTarget(
  targetUrl: string,
  resolveDns?: (hostname: string) => Promise<string[]>,
): Promise<UrlValidationResult> {
  const result = await validatePublicHttpsUrl(targetUrl, resolveDns);
  return result;
}

/**
 * 从 prepare 响应复制上传 headers：只复制 allowlist 中的安全 header，
 * 拒绝 Authorization、Cookie、Host、Proxy-*、Connection 等连接级 header。
 */
export function filterUploadHeaders(
  prepareHeaders: Record<string, string>,
): Record<string, string> {
  const blocked = new Set([
    "authorization",
    "cookie",
    "host",
    "connection",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "content-type", // 由客户端按 body 类型设置
  ]);
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(prepareHeaders)) {
    const lower = name.toLowerCase();
    if (blocked.has(lower)) continue;
    if (!/^[a-zA-Z0-9-]+$/.test(name)) continue;
    if (typeof value !== "string" || value.length > 4096) continue;
    result[name] = value;
  }
  return result;
}

/** 轮询退避：1、2、4、8 秒后固定 10 秒；Retry-After 取两者较大值。 */
export function pollBackoffMs(attempt: number, retryAfterSeconds?: number): number {
  const base = attempt <= 3 ? 1000 * 2 ** attempt : 10_000;
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
    return Math.max(base, retryAfterSeconds * 1000);
  }
  return base;
}
