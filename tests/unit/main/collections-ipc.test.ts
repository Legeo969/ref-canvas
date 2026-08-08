import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { registerCollectionsIpc } from "../../../src/main/ipc/collections-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

const temporaryDirectories: string[] = [];

async function removeDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeDirectory));
});

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-collipc-"));
  temporaryDirectories.push(directory);
  const database = new RefCanvasDatabase(path.join(directory, "app.db"));
  const notifyCollectionsChanged = vi.fn();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
  } as unknown as SecureIpcRegistrar;
  registerCollectionsIpc(ipc, { getDatabase: () => database, notifyCollectionsChanged });
  // 模拟 ipcMain.handle 语义：同步抛错也转为拒绝的 Promise。
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel)!;
    return await handler(...args);
  };
  return { database, handlers, notifyCollectionsChanged, directory, invoke };
}

describe("collections IPC (FND-003)", () => {
  it("creates, lists, updates and deletes a collection through IPC", async () => {
    const { database, notifyCollectionsChanged, invoke } = await setup();
    try {
      const created = (await invoke("collections:create", {
        name: "灵感",
      })) as { id: string; name: string; parentId: string | null };
      expect(created.name).toBe("灵感");
      expect(notifyCollectionsChanged).toHaveBeenCalledTimes(1);

      const listed = (await invoke("collections:list")) as Array<{
        id: string;
      }>;
      expect(listed).toHaveLength(1);

      const updated = (await invoke("collections:update", {
        id: created.id,
        patch: { name: "角色" },
      })) as { name: string };
      expect(updated.name).toBe("角色");

      await invoke("collections:create", {
        parentId: created.id,
        name: "子集",
      });

      // 非递归删除非空父集合被拒绝。
      await expect(
        invoke("collections:delete", { id: created.id, recursive: false }),
      ).rejects.toThrow("COLLECTION_NOT_EMPTY");

      await invoke("collections:delete", { id: created.id, recursive: true });
      const after = (await invoke("collections:list")) as unknown[];
      expect(after).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("adds and resolves items with schema validation before touching storage", async () => {
    const { database, directory, invoke } = await setup();
    try {
      const source = path.join(directory, "a.png");
      await writeFile(source, Buffer.alloc(64, 7));
      const collection = (await invoke("collections:create", {
        name: "素材",
      })) as { id: string };
      const items = (await invoke("collections:add-paths", {
        collectionId: collection.id,
        paths: [source],
      })) as Array<{ id: string; state: string }>;
      expect(items).toHaveLength(1);
      expect(items[0].state).toBe("resolved");

      const resolved = (await invoke("collections:resolve", collection.id)) as Array<{
        item: { state: string };
        relinked: boolean;
      }>;
      expect(resolved[0].item.state).toBe("resolved");

      // 无效输入在调用仓储前被 Zod 拒绝。
      await expect(
        invoke("collections:add-paths", {
          collectionId: collection.id,
          paths: [],
        }),
      ).rejects.toThrow();
      await expect(invoke("collections:create", { name: "  " })).rejects.toThrow();
    } finally {
      database.close();
    }
  });

  it("relink requires fingerprint confirmation through IPC", async () => {
    const { database, directory, invoke } = await setup();
    try {
      const source = path.join(directory, "a.png");
      await writeFile(source, Buffer.alloc(64, 7));
      const collection = (await invoke("collections:create", {
        name: "素材",
      })) as { id: string };
      const items = (await invoke("collections:add-paths", {
        collectionId: collection.id,
        paths: [source],
      })) as Array<{ id: string }>;
      const different = path.join(directory, "b.png");
      await writeFile(different, Buffer.alloc(128, 9));
      await expect(
        invoke("collections:relink", {
          itemId: items[0].id,
          path: different,
          confirmFingerprintChange: false,
        }),
      ).rejects.toThrow("RELINE_FINGERPRINT_CHANGED");
      const relinked = (await invoke("collections:relink", {
        itemId: items[0].id,
        path: different,
        confirmFingerprintChange: true,
      })) as { lastResolvedPath: string };
      expect(relinked.lastResolvedPath).toBe(different);
    } finally {
      database.close();
    }
  });
});
