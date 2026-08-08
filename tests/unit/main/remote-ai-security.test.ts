import { describe, expect, it } from "vitest";
import {
  filterUploadHeaders,
  pollBackoffMs,
  validatePublicHttpsUrl,
  validateRedirectTarget,
} from "../../../src/main/services/ai/remote-ai-security";

/** 假 DNS：把域名解析到指定地址（测试防 rebinding）。 */
function dnsResolvingTo(addresses: string[]) {
  return async () => addresses;
}

describe("remote-ai-security (FND-010 §9.6)", () => {
  it("accepts public HTTPS URLs with public DNS", async () => {
    const result = await validatePublicHttpsUrl(
      "https://api.example.com/v1",
      dnsResolvingTo(["93.184.216.34"]),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects HTTP, embedded credentials and empty hosts", async () => {
    const publicDns = dnsResolvingTo(["93.184.216.34"]);
    expect((await validatePublicHttpsUrl("http://api.example.com", publicDns)).ok).toBe(false);
    expect((await validatePublicHttpsUrl("https://user:pass@api.example.com", publicDns)).ok).toBe(false);
    // 非法 URL 被解析层拒绝（返回 ok:false）。
    const invalid = await validatePublicHttpsUrl("https://exa mple.com/path", publicDns);
    expect(invalid.ok).toBe(false);
  });

  it("rejects literal loopback, link-local and private IPs", async () => {
    for (const url of [
      "https://127.0.0.1:8443/v1",
      "https://localhost:8443/v1",
      "https://10.0.0.5/v1",
      "https://172.16.5.5/v1",
      "https://192.168.1.1/v1",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]:8443/v1",
      "https://[fe80::1]/v1",
    ]) {
      const result = await validatePublicHttpsUrl(url, dnsResolvingTo(["93.184.216.34"]));
      expect(result.ok, url).toBe(false);
    }
  });

  it("rejects public-looking domains that resolve to private IPs (rebinding)", async () => {
    const result = await validatePublicHttpsUrl(
      "https://api.example.com",
      dnsResolvingTo(["127.0.0.1", "169.254.169.254", "10.0.0.1"]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("私网");
  });

  it("rejects failed DNS resolution", async () => {
    const result = await validatePublicHttpsUrl("https://api.example.com", async () => {
      throw new Error("ENOTFOUND");
    });
    expect(result.ok).toBe(false);
  });

  it("allows multi-A public results", async () => {
    const result = await validatePublicHttpsUrl(
      "https://api.example.com",
      dnsResolvingTo(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects any private address among mixed results", async () => {
    const result = await validatePublicHttpsUrl(
      "https://api.example.com",
      dnsResolvingTo(["93.184.216.34", "127.0.0.1"]),
    );
    expect(result.ok).toBe(false);
  });

  it("redirect target validation re-checks public address", async () => {
    expect(
      (await validateRedirectTarget("https://cdn.example.com/x.png", dnsResolvingTo(["93.184.216.34"]))).ok,
    ).toBe(true);
    expect(
      (await validateRedirectTarget("https://10.0.0.9/x.png", dnsResolvingTo(["93.184.216.34"]))).ok,
    ).toBe(false);
  });

  it("filters upload headers with an allowlist and blocks sensitive headers", () => {
    const filtered = filterUploadHeaders({
      "x-amz-credential": "abc",
      "x-amz-date": "2026",
      "content-md5": "x",
      Authorization: "Bearer secret",
      Cookie: "session=1",
      Host: "bucket.s3.amazonaws.com",
      "Proxy-Connection": "keep-alive",
      "Content-Type": "image/png",
    });
    expect(filtered["x-amz-credential"]).toBe("abc");
    expect(filtered["content-md5"]).toBe("x");
    expect(filtered["Authorization"]).toBeUndefined();
    expect(filtered["Cookie"]).toBeUndefined();
    expect(filtered["Host"]).toBeUndefined();
    expect(filtered["Proxy-Connection"]).toBeUndefined();
    expect(filtered["Content-Type"]).toBeUndefined();
  });

  it("poll backoff: 1,2,4,8 then 10s; Retry-After takes max", () => {
    expect(pollBackoffMs(0, 0)).toBe(1000);
    expect(pollBackoffMs(1, 0)).toBe(2000);
    expect(pollBackoffMs(2, 0)).toBe(4000);
    expect(pollBackoffMs(3, 0)).toBe(8000);
    expect(pollBackoffMs(4, 0)).toBe(10_000);
    expect(pollBackoffMs(10, 0)).toBe(10_000);
    // Retry-After 取较大值。
    expect(pollBackoffMs(0, 30)).toBe(30_000);
    expect(pollBackoffMs(3, 2)).toBe(8000);
  });
});
