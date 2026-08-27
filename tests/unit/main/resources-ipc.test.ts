import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerResourcesIpc } from "../../../src/main/ipc/resources-ipc";
import { previewCacheKey } from "../../../src/main/platform/preview-cache-key";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

describe("resources IPC mount events", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    // Windows 上 sharp/libvips 写完 WebP 后文件句柄可能延迟释放，
    // 直接 rm 会触发 EBUSY；短暂等待并重试几次。
    const removeWithRetry = async (directory: string, retries = 5) => {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          await rm(directory, { recursive: true, force: true });
          return;
        } catch (error) {
          if (attempt === retries - 1) throw error;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    };
    await Promise.all(temporaryDirectories.splice(0).map(removeWithRetry));
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
    const authorize = vi.fn(async (
      _window: Electron.BrowserWindow,
      _operation: string,
      requests: Array<{ path: string }>,
    ) => requests.map((request) => request.path));
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
      windowForSender: () => ({}) as Electron.BrowserWindow,
      writeAccess: { authorize },
      getMediaJobRegistry: () => ({ start: vi.fn(), attachController: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), list: vi.fn(() => []) }),
    } as unknown as Parameters<typeof registerResourcesIpc>[1];
    registerResourcesIpc(ipc, dependencies);

    await handlers.get("mounts:add")?.("D:\\refs");
    expect(authorize).toHaveBeenCalledWith(
      expect.anything(),
      "mount",
      [{ path: "D:\\refs", mode: "destination" }],
    );
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
      getPreviewCacheIndex: () => null,
      getScriptsService: () => ({}),
      previewTokens: {},
      notifyMountsChanged: vi.fn(),
      getMediaJobRegistry: () => ({ start: vi.fn(), attachController: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), list: vi.fn(() => []) }),
    } as unknown as Parameters<typeof registerResourcesIpc>[1];
    registerResourcesIpc(ipc, dependencies);

    const palette = await handlers.get("media:palette")?.(filename, { limit: 2 });
    expect(palette).toEqual(expect.arrayContaining([
      expect.objectContaining({ hex: expect.stringMatching(/^#[0-9a-f]{6}$/) }),
    ]));
    expect((palette as Array<unknown>).length).toBe(2);
  });

  // 白板取色：主进程按 uv 直接采样源文件像素（画布 tainted 时唯一可行路径）。
  it("samples a source-file pixel by normalized coordinates", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-sample-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "solid.png");
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 18, g: 52, b: 86 } },
    }).png().toFile(filename);

    const assetId = randomUUID();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    registerResourcesIpc(ipc, {
      getDatabase: () => ({ getAssetSource: (id: string) => ({
        id, sourcePath: filename,
      }) }),
      getLibrary: () => ({}), getMountService: () => ({}),
      getProviderRegistry: () => ({}), getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => directory, getPreviewCacheIndex: () => null, getScriptsService: () => ({}),
      previewTokens: {}, notifyMountsChanged: vi.fn(),
      getMediaJobRegistry: () => ({ start: vi.fn(), attachController: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), list: vi.fn(() => []) }),
      writeAccess: { authorize: vi.fn() },
    } as unknown as Parameters<typeof registerResourcesIpc>[1]);

    const sample = await handlers.get("color:sample-image")?.({
      assetId, u: 0.9, v: 0.9,
    });
    expect(sample).toEqual({ hex: "#123456", alpha: 255 });

    // 非法 uuid 被拒绝。
    await expect(
      handlers.get("color:sample-image")?.({ assetId: "nope", u: 0, v: 0 }),
    ).rejects.toThrow();
  });

  it("extracts a BMP palette through a temporary PNG conversion", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-bmp-palette-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "solid.bmp");
    await writeFile(filename, Buffer.from(
      "Qk1mAAAAAAAAADYAAAAoAAAABAAAAAQAAAABABgAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQS",
      "base64",
    ));

    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    registerResourcesIpc(ipc, {
      getDatabase: () => ({}), getLibrary: () => ({}), getMountService: () => ({}),
      getProviderRegistry: () => ({}), getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => directory, getPreviewCacheIndex: () => null, getScriptsService: () => ({}),
      previewTokens: {}, notifyMountsChanged: vi.fn(),
      getMediaJobRegistry: () => ({ start: vi.fn(), attachController: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), list: vi.fn(() => []) }),
    } as unknown as Parameters<typeof registerResourcesIpc>[1]);

    const palette = await handlers.get("media:palette")?.(filename, { limit: 2 });
    expect(palette).toEqual(expect.arrayContaining([
      expect.objectContaining({ hex: expect.stringMatching(/^#[0-9a-f]{6}$/) }),
    ]));
  });

  it("extracts an HDR palette from its provider-generated display preview", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-hdr-palette-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "environment.hdr");
    await writeFile(filename, "HDR fixture placeholder");
    const thumbnail = vi.fn(async (input: { outputPath?: string }) => {
      const outputPath = input.outputPath!;
      await sharp({
        create: { width: 8, height: 4, channels: 4, background: { r: 80, g: 140, b: 210, alpha: 1 } },
      }).webp({ quality: 85 }).toFile(outputPath);
      return { path: outputPath, width: 8, height: 4 };
    });
    const provider = { thumbnail };
    const registry = {
      invoke: vi.fn(async (_kind, _extension, capability, run) => ({
        value: await run(provider),
        meta: { providerId: "hdr-test", providerVersion: "1", capability, fellBack: false, durationMs: 0, errorCode: null },
      })),
    };
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    registerResourcesIpc(ipc, {
      getDatabase: () => ({}), getLibrary: () => ({}), getMountService: () => ({}),
      getProviderRegistry: () => registry, getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => directory, getPreviewCacheIndex: () => null, getScriptsService: () => ({}),
      previewTokens: {}, notifyMountsChanged: vi.fn(),
      getMediaJobRegistry: () => ({ start: vi.fn(), attachController: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), list: vi.fn(() => []) }),
    } as unknown as Parameters<typeof registerResourcesIpc>[1]);

    const palette = await handlers.get("media:palette")?.(filename, { limit: 3 });
    expect(thumbnail).toHaveBeenCalledOnce();
    expect(palette).toEqual(expect.arrayContaining([
      expect.objectContaining({ hex: expect.stringMatching(/^#[0-9a-f]{6}$/) }),
    ]));
  });

  it("persists the HDR palette sample and reuses it on the next call", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-hdr-palette-cache-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "environment.hdr");
    await writeFile(filename, "HDR fixture placeholder");
    const thumbnail = vi.fn(async (input: { outputPath?: string }) => {
      const outputPath = input.outputPath!;
      await sharp({
        create: { width: 8, height: 4, channels: 4, background: { r: 80, g: 140, b: 210, alpha: 1 } },
      }).webp({ quality: 85 }).toFile(outputPath);
      return { path: outputPath, width: 8, height: 4 };
    });
    const registry = {
      invoke: vi.fn(async (_kind, _extension, capability, run) => ({
        value: await run({ thumbnail }),
        meta: { providerId: "hdr-test", providerVersion: "1", capability, fellBack: false, durationMs: 0, errorCode: null },
      })),
    };
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    registerResourcesIpc(ipc, {
      getDatabase: () => ({}), getLibrary: () => ({}), getMountService: () => ({}),
      getProviderRegistry: () => registry, getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => directory, getPreviewCacheIndex: () => null, getScriptsService: () => ({}),
      previewTokens: {}, notifyMountsChanged: vi.fn(),
      getMediaJobRegistry: () => ({ start: vi.fn(), attachController: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), list: vi.fn(() => []) }),
    } as unknown as Parameters<typeof registerResourcesIpc>[1]);

    await handlers.get("media:palette")?.(filename, { limit: 3 });
    await handlers.get("media:palette")?.(filename, { limit: 3 });
    expect(thumbnail).toHaveBeenCalledOnce();
  });

  it("reuses an existing display variant PNG for HDR palettes instead of re-decoding", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-hdr-palette-reuse-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "environment.hdr");
    await writeFile(filename, "HDR fixture placeholder");
    const { size, mtimeMs } = await stat(filename);
    const displayKey = previewCacheKey({
      realPath: filename,
      size,
      mtimeMs,
      variant: "thumbnail-1920x1920-webp",
    });
    const displayDirectory = path.join(directory, "directory");
    await mkdir(displayDirectory, { recursive: true });
    await sharp({
      create: { width: 8, height: 4, channels: 4, background: { r: 200, g: 40, b: 20, alpha: 1 } },
    }).webp({ quality: 85 }).toFile(path.join(displayDirectory, `${displayKey}.webp`));
    const thumbnail = vi.fn();
    const registry = {
      invoke: vi.fn(async (_kind, _extension, capability, run) => ({
        value: await run({ thumbnail }),
        meta: { providerId: "hdr-test", providerVersion: "1", capability, fellBack: false, durationMs: 0, errorCode: null },
      })),
    };
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    registerResourcesIpc(ipc, {
      getDatabase: () => ({}), getLibrary: () => ({}), getMountService: () => ({}),
      getProviderRegistry: () => registry, getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => directory, getPreviewCacheIndex: () => null, getScriptsService: () => ({}),
      previewTokens: {}, notifyMountsChanged: vi.fn(),
      getMediaJobRegistry: () => ({ start: vi.fn(), attachController: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), list: vi.fn(() => []) }),
    } as unknown as Parameters<typeof registerResourcesIpc>[1]);

    const palette = await handlers.get("media:palette")?.(filename, { limit: 3 });
    expect(thumbnail).not.toHaveBeenCalled();
    expect(palette).toEqual(expect.arrayContaining([
      expect.objectContaining({ hex: expect.stringMatching(/^#[0-9a-f]{6}$/) }),
    ]));
  });

  it("validates script registration bounds and runs only after drive authorization", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    const register = vi.fn(async () => ({ id: "s1" }));
    const run = vi.fn(async () => ({
      exitCode: 0,
      output: "",
      timedOut: false,
      failureReason: null,
      durationMs: 1,
    }));
    const authorize = vi.fn(async (_window: unknown, _operation: string, requests: Array<{ path: string }>) =>
      requests.map((request) => request.path));
    registerResourcesIpc(ipc, {
      getDatabase: () => ({}),
      getLibrary: () => ({}),
      getMountService: () => ({}),
      getProviderRegistry: () => ({}),
      getThumbnailWorker: () => null,
      getThumbnailCacheDirectory: () => "D:\\cache",
      getScriptsService: () => ({ list: () => [], unregister: vi.fn(), inspect: vi.fn(), register, run }),
      writeAccess: { authorize },
      windowForSender: () => ({ id: 1 }),
      previewTokens: {},
      notifyMountsChanged: vi.fn(),
      getMediaJobRegistry: () => ({ start: vi.fn(), attachController: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), list: vi.fn(() => []) }),
    } as unknown as Parameters<typeof registerResourcesIpc>[1]);

    // 注册输入必须有界：空路径与过小超时被 zod 拒绝且不触达服务。
    // 处理器是 async，校验失败表现为 Promise 拒绝（与 Electron ipc.handle 一致）。
    await expect(
      handlers.get("scripts:register")?.({ path: "", timeoutMs: 60_000 }),
    ).rejects.toThrow();
    await expect(
      handlers.get("scripts:register")?.({ path: "D:\\x.py", timeoutMs: 1 }),
    ).rejects.toThrow();
    expect(register).not.toHaveBeenCalled();

    await handlers.get("scripts:register")?.({ path: "D:\\tools\\hello.py", timeoutMs: 60_000 });
    expect(register).toHaveBeenCalledWith("D:\\tools\\hello.py", undefined, 60_000);

    // 运行前 cwd 必须先过目录范围校验，再转发给服务。
    await handlers.get("scripts:run")?.({ id: "s1", cwd: "D:\\work" });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("s1", "D:\\work");
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
      getMediaJobRegistry: () => ({ start: vi.fn(), attachController: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), list: vi.fn(() => []) }),
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
