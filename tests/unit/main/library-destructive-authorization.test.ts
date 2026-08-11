import { describe, expect, it, vi } from "vitest";
import { registerLibraryIpc } from "../../../src/main/ipc/library-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

describe("library destructive batch authorization", () => {
  it("passes the full final canonical purge snapshot to the service before unlinking", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    const paths = ["C:\\trash\\a.exr", "D:\\trash\\b.exr"];
    const finalPaths = ["C:\\canonical\\a.exr", "D:\\canonical\\b.exr"];
    const authorize = vi.fn()
      .mockResolvedValueOnce(paths)
      .mockResolvedValueOnce(finalPaths);
    const purgeAssetsByAuthorizedPaths = vi.fn(async () => 2);
    registerLibraryIpc(ipc, {
      getDatabase: () => ({
        getAsset: (id: string) => ({
          id,
          lifecycle: "trashed",
          trashPath: paths[ids.indexOf(id)],
        }),
      }),
      getLibrary: () => ({ purgeAssetsByAuthorizedPaths }),
      copyProjectAsset: vi.fn(),
      safeFilename: (value: string) => value,
      windowForSender: () => ({}) as Electron.BrowserWindow,
      writeAccess: { authorize },
    } as unknown as Parameters<typeof registerLibraryIpc>[1]);

    await expect(handlers.get("library:purge")?.(ids)).resolves.toBe(2);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(purgeAssetsByAuthorizedPaths).toHaveBeenCalledWith([
      { id: ids[0], trashPath: finalPaths[0] },
      { id: ids[1], trashPath: finalPaths[1] },
    ]);
    expect(purgeAssetsByAuthorizedPaths.mock.invocationCallOrder[0]).toBeGreaterThan(
      authorize.mock.invocationCallOrder[1],
    );
  });

  it("does not start purge when the full-set final check is denied", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, (...args) => handler({}, ...args)),
    } as unknown as SecureIpcRegistrar;
    const id = "11111111-1111-4111-8111-111111111111";
    const authorize = vi.fn()
      .mockResolvedValueOnce(["C:\\trash\\a.exr"])
      .mockRejectedValueOnce(new Error("WRITE_ACCESS_DENIED"));
    const purgeAssetsByAuthorizedPaths = vi.fn();
    registerLibraryIpc(ipc, {
      getDatabase: () => ({
        getAsset: () => ({ id, lifecycle: "trashed", trashPath: "C:\\trash\\a.exr" }),
      }),
      getLibrary: () => ({ purgeAssetsByAuthorizedPaths }),
      copyProjectAsset: vi.fn(),
      safeFilename: (value: string) => value,
      windowForSender: () => ({}) as Electron.BrowserWindow,
      writeAccess: { authorize },
    } as unknown as Parameters<typeof registerLibraryIpc>[1]);

    await expect(handlers.get("library:purge")?.([id]))
      .rejects.toThrow("WRITE_ACCESS_DENIED");
    expect(purgeAssetsByAuthorizedPaths).not.toHaveBeenCalled();
  });
});
