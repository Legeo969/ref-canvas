import { describe, expect, it } from "vitest";
import { BrowserCapturePairingService } from "../../../src/main/services/browser-capture-pairing-service";

const ORIGIN = `chrome-extension://${"b".repeat(32)}`;

function createStore() {
  const values = new Map<string, unknown>();
  return {
    values,
    getSetting<T>(key: string, fallback: T): T {
      return (values.get(key) as T | undefined) ?? fallback;
    },
    setSetting(key: string, value: unknown): void {
      values.set(key, value);
    },
  };
}

describe("BrowserCapturePairingService", () => {
  it("uses a one-time code and stores only a token hash", () => {
    const store = createStore();
    const service = new BrowserCapturePairingService(() => store, () => 1_000);
    const code = service.createPairingCode();
    expect(code.code).toMatch(/^\d{6}$/);

    const result = service.pair(code.code, ORIGIN, "Edge");
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(service.authenticate(ORIGIN, result.token)?.label).toBe("Edge");
    expect(JSON.stringify([...store.values.values()])).not.toContain(result.token);
    expect(() => service.pair(code.code, ORIGIN)).toThrow("PAIRING_CODE_EXPIRED");
  });

  it("rejects expired codes and non-extension origins", () => {
    const store = createStore();
    let now = 2_000;
    const service = new BrowserCapturePairingService(() => store, () => now);
    const code = service.createPairingCode();
    expect(() => service.pair(code.code, "https://example.com")).toThrow(
      "PAIRING_ORIGIN_REJECTED",
    );
    now += 60_001;
    expect(() => service.pair(code.code, ORIGIN)).toThrow("PAIRING_CODE_EXPIRED");
  });

  it("revokes a token immediately", () => {
    const store = createStore();
    const service = new BrowserCapturePairingService(() => store);
    const code = service.createPairingCode();
    const result = service.pair(code.code, ORIGIN);
    service.revokePairing(result.pairing.id);
    expect(service.authenticate(ORIGIN, result.token)).toBeNull();
    expect(service.listPairings()).toEqual([]);
  });
});
