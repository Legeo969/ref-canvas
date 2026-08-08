import { describe, expect, it, vi } from "vitest";
import { registerResourcesIpc } from "../../../src/main/ipc/resources-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

describe("resources IPC mount events", () => {
  it("broadcasts successful mount additions and removals", async () => {
    const mountId = "11111111-1111-4111-8111-111111111111";
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (
        channel: string,
        handler: (...args: unknown[]) => unknown,
      ) => handlers.set(channel, handler),
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
});
