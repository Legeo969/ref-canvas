import { describe, expect, it, vi } from "vitest";
import { registerActionIpc } from "../../../src/main/ipc/action-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";
import { ActionPresetService } from "../../../src/main/services/action-preset-service";

function createStore() {
  const values = new Map<string, unknown>();
  return {
    getSetting<T>(key: string, fallback: T): T {
      return (values.get(key) as T | undefined) ?? fallback;
    },
    setSetting(key: string, value: unknown): void {
      values.set(key, value);
    },
  };
}

describe("ActionPresetService", () => {
  it("persists declarative presets and supports update/delete", () => {
    const store = createStore();
    const service = new ActionPresetService(() => store);
    const saved = service.save({
      name: "WebP delivery",
      type: "webp",
      options: { format: "webp", quality: 82 },
      namingTemplate: "{name}-{index}",
    });
    expect(service.list()).toEqual([saved]);
    expect(service.update(saved.id, {
      name: "WebP compact",
      type: "webp",
      options: { format: "webp", quality: 70 },
    })).toMatchObject({ id: saved.id, name: "WebP compact" });
    service.delete(saved.id);
    expect(service.list()).toEqual([]);
  });

  it("rejects command-like fields before a preset reaches storage", () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as unknown as SecureIpcRegistrar;
    const save = vi.fn();
    registerActionIpc(ipc, {
      getActions: () => ({}),
      getPresets: () => ({ save }),
      windowForSender: vi.fn(),
      writeAccess: { authorize: vi.fn() },
    } as unknown as Parameters<typeof registerActionIpc>[1]);

    expect(() => handlers.get("actions:save-preset")!({
      name: "Unsafe",
      type: "export-folder",
      options: { command: "cmd.exe", script: "payload.ps1" },
    })).toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});
