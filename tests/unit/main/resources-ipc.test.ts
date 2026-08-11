import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerResourcesIpc } from "../../../src/main/ipc/resources-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

describe("resources IPC mount events", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it("broadcasts successful mount additions and removals", async () => {
    const mountId = "11111111-1111-4111-8111-111111111111";
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (
        channel: string,
        handler: (...args: unknown[]) => unknown,
      ) => handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    const mounts: Array<{
      id: string;
      path: string;
      displayName: string;
      volumeId: string | null;
      state: "online" | "offline" | "permission-denied";
      lastSeenAt: string | null;
    }> = [];
    const addWatchRoot = vi.fn(async () => ({
      id: mountId,
      path: "D:\\refs",
    }));
    const removeWatchRoot = vi.fn(async () => undefined);
    const notifyMountsChanged = vi.fn();
    addWatchRoot.mockImplementationOnce(async () => {
      mounts.push({
        id: mountId,
        path: "D:\\refs",
        displayName: "refs",
        volumeId: null,
        state: "online",
        lastSeenAt: null,
      });
      return { id: mountId, path: "D:\\refs" };
    });
    const dependencies = {
      getDatabase: () => ({
        listMountRoots: () => mounts,
      }),
      getLibrary: () => ({ addWatchRoot, removeWatchRoot }),
      getMountService: () => ({}),
      getProviderRegistry: () => ({}),
      getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => "D:\\cache",
      getScriptsService: () => ({}),
      previewTokens: {},
      notifyMountsChanged,
    } as unknown as Parameters<typeof registerResourcesIpc>[1];
    registerResourcesIpc(ipc, dependencies);

    await handlers.get("mounts:add")?.("D:\\refs");
    expect(notifyMountsChanged).toHaveBeenCalledWith({
      type: "added",
      mountId,
      state: "online",
    });

    await handlers.get("mounts:remove")?.(mountId);
    expect(removeWatchRoot).toHaveBeenCalledWith(mountId);
    expect(notifyMountsChanged).toHaveBeenLastCalledWith({
      type: "removed",
      mountId,
    });
  });

  it("extracts an image palette in the main process", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-palette-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "split.png");
    const pixels = Buffer.alloc(4 * 4 * 4);
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      pixels[offset] = index < 12 ? 240 : 20;
      pixels[offset + 1] = index < 12 ? 30 : 60;
      pixels[offset + 2] = index < 12 ? 40 : 220;
      pixels[offset + 3] = 255;
    }
    await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } })
      .png()
      .toFile(filename);

    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    const dependencies = {
      getDatabase: () => ({}),
      getLibrary: () => ({}),
      getMountService: () => ({}),
      getProviderRegistry: () => ({}),
      getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => directory,
      getScriptsService: () => ({}),
      previewTokens: {},
      notifyMountsChanged: vi.fn(),
    } as unknown as Parameters<typeof registerResourcesIpc>[1];
    registerResourcesIpc(ipc, dependencies);

    const palette = await handlers.get("media:palette")?.(filename, { limit: 2 });
    expect(palette).toEqual(expect.arrayContaining([
      expect.objectContaining({ hex: expect.stringMatching(/^#[0-9a-f]{6}$/) }),
    ]));
    expect((palette as Array<unknown>).length).toBe(2);
  });

  it("fails closed for renderer-triggered arbitrary script registration and execution", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    const register = vi.fn();
    const run = vi.fn();
    registerResourcesIpc(ipc, {
      getDatabase: () => ({}),
      getLibrary: () => ({}),
      getMountService: () => ({}),
      getProviderRegistry: () => ({}),
      getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => "D:\\cache",
      getScriptsService: () => ({ list: () => [], unregister: vi.fn(), register, run }),
      previewTokens: {},
      notifyMountsChanged: vi.fn(),
    } as unknown as Parameters<typeof registerResourcesIpc>[1]);

    expect(() => handlers.get("scripts:register")?.({
      path: "D:\\attack.ps1",
      timeoutMs: 60_000,
    })).toThrow("SCRIPT_EXECUTION_DISABLED_UNSANDBOXED");
    expect(() => handlers.get("scripts:run")?.({
      id: "attacker",
      cwd: "D:\\",
    })).toThrow("SCRIPT_EXECUTION_DISABLED_UNSANDBOXED");
    expect(register).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("finishes the full backup-downscale authorization set before any media mutation", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    const authorize = vi.fn()
      .mockImplementationOnce(async (
        _window: Electron.BrowserWindow,
        _operation: string,
        requests: Array<{ path: string }>,
      ) => requests.map((request) => request.path))
      .mockRejectedValueOnce(new Error("WRITE_ACCESS_DENIED"));
    registerResourcesIpc(ipc, {
      getDatabase: () => ({ getSetting: () => ({}) }),
      getLibrary: () => ({}),
      getMountService: () => ({}),
      getProviderRegistry: () => ({}),
      getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => "D:\\cache",
      getScriptsService: () => ({}),
      previewTokens: {},
      notifyMountsChanged: vi.fn(),
      windowForSender: () => ({}) as Electron.BrowserWindow,
      writeAccess: { authorize },
    } as unknown as Parameters<typeof registerResourcesIpc>[1]);

    await expect(handlers.get("media:downscale")?.({
      paths: ["C:\\images\\a.png", "D:\\images\\b.png"],
      maxDimension: 2_048,
      mode: "backup",
    })).rejects.toThrow("WRITE_ACCESS_DENIED");
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize.mock.calls[1][2]).toHaveLength(6);
  });
});
