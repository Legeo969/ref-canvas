import { describe, expect, it } from "vitest";
import {
  evaluateProtocolRequest,
  protocolResponseHeaders,
} from "../../../src/main/platform/protocol-origin-policy";

const options = {
  allowedOrigins: ["http://localhost:5173"],
  allowedReferrerPrefixes: ["http://localhost:5173/", "file:///C:/Program%20Files/RefCanvas/resources/app/"],
};

function request(headers: Record<string, string>): Pick<Request, "headers"> {
  return { headers: new Headers(headers) };
}

describe("protocol origin policy", () => {
  it("echoes an exact configured development origin", () => {
    const decision = evaluateProtocolRequest(request({ origin: "http://localhost:5173" }), options);
    expect(decision).toEqual({ allowed: true, corsOrigin: "http://localhost:5173" });
    expect(protocolResponseHeaders(decision)["Access-Control-Allow-Origin"])
      .toBe("http://localhost:5173");
  });

  it("allows a packaged renderer referrer without granting wildcard CORS", () => {
    const decision = evaluateProtocolRequest(
      request({ referer: "file:///C:/Program%20Files/RefCanvas/resources/app/index.html" }),
      options,
    );
    expect(decision).toEqual({ allowed: true });
    expect(protocolResponseHeaders(decision)).not.toHaveProperty("Access-Control-Allow-Origin");
  });

  it("uses the Electron Request referrer property when no header is present", () => {
    const decision = evaluateProtocolRequest({
      headers: new Headers(),
      referrer: "http://localhost:5173/preview",
    }, options);
    expect(decision).toEqual({ allowed: true, corsOrigin: "http://localhost:5173" });
  });

  it("allows Chromium's null file origin only with the packaged renderer referrer", () => {
    const trusted = evaluateProtocolRequest(request({
      origin: "null",
      referer: "file:///C:/Program%20Files/RefCanvas/resources/app/index.html",
    }), options);
    expect(trusted).toEqual({ allowed: true, corsOrigin: "null" });
    expect(evaluateProtocolRequest(request({ origin: "null" }), options).allowed).toBe(false);
    expect(evaluateProtocolRequest(request({
      origin: "null",
      referer: "file:///C:/Users/Public/evil.html",
    }), options).allowed).toBe(false);
  });

  it("rejects malicious origins and referrers", () => {
    expect(evaluateProtocolRequest(request({ origin: "https://evil.example" }), options).allowed).toBe(false);
    expect(evaluateProtocolRequest(request({ referer: "https://evil.example/x" }), options).allowed).toBe(false);
    expect(evaluateProtocolRequest(request({ referer: "http://localhost:51730/x" }), options).allowed).toBe(false);
    expect(evaluateProtocolRequest(request({
      origin: "http://localhost:5173",
      referer: "https://evil.example/x",
    }), options).allowed).toBe(false);
    expect(evaluateProtocolRequest(request({ referer: "http://user@localhost:5173/x" }), options).allowed).toBe(false);
    expect(evaluateProtocolRequest(request({
      referer: "file:///C:/Program%20Files/RefCanvas/resources/app/%2e%2e/evil.html",
    }), options).allowed).toBe(false);
    expect(evaluateProtocolRequest(request({
      referer: "file:///C:/Program%20Files/RefCanvas/resources/app/../../evil.html",
    }), options).allowed).toBe(false);
    expect(evaluateProtocolRequest(request({
      referer: "file:///C:/Program%20Files/RefCanvas/resources/app-evil/index.html",
    }), options).allowed).toBe(false);
  });

  it("deliberately permits provenance-free direct image loads without CORS", () => {
    const decision = evaluateProtocolRequest(request({}), options);
    expect(decision).toEqual({ allowed: true });
    expect(protocolResponseHeaders(decision)).not.toHaveProperty("Access-Control-Allow-Origin");
  });

  it("varies protocol responses on both provenance headers", () => {
    expect(protocolResponseHeaders({ allowed: true }).Vary).toBe("Origin, Referer");
  });
});
