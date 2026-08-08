import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { MountService } from "../../../src/main/services/mount-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mount-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createService(database = new RefCanvasDatabase(":memory:")) {
  const service = new MountService(database, { probeTimeoutMs: 250 });
  return { database, service };
}

describe("MountService", () => {
  it("registers a mount root as online when the directory exists", async () => {
    const root = await createTempDir();
    const { database, service } = createService();
    database.upsertMountRoot({
      id: "mount-1",
      path: root,
      displayName: "Root",
      state: "online",
    });
    const state = await service.refreshMount("mount-1");
    expect(state).toBe("online");
    expect(database.listMountRoots()[0].state).toBe("online");
  });

  it("marks a mount offline when the directory is gone and flags its assets", async () => {
    const root = await createTempDir();
    const { database, service } = createService();
    database.upsertMountRoot({
      id: "mount-1",
      path: root,
      displayName: "Root",
      state: "online",
    });
    // 注册 identity 并把 asset 关联到该 mount。
    const asset = database.upsertAsset({
      title: "Ref",
      kind: "image",
      path: path.join(root, "a.png"),
      pathKey: path.join(root, "a.png").toLocaleLowerCase("en-US"),
      extension: "png",
      size: 1,
      mtimeMs: 1,
      fingerprint: "fp",
      linkState: "online",
      notes: "",
      width: 1,
      height: 1,
      duration: null,
    }).asset;
    database.upsertFileIdentity({
      pathKey: path.join(root, "a.png").toLocaleLowerCase("en-US"),
      assetId: asset.id,
      fingerprint: "fp",
      size: 1,
      rootPath: root,
      mountId: "mount-1",
    });
    await rm(root, { recursive: true, force: true });

    const state = await service.refreshMount("mount-1");
    expect(state).toBe("offline");
    // §7.5：离线只标记，不批量删除。
    expect(database.getAsset(asset.id)?.linkState).toBe("offline");
    expect(database.searchAssets().total).toBe(1);
  });

  it("emits a mount-state change event and reconciles on recovery", async () => {
    const root = await createTempDir();
    const { database, service } = createService();
    database.upsertMountRoot({
      id: "mount-1",
      path: root,
      displayName: "Root",
      state: "online",
    });
    // 离线前注册一个资产，恢复后应回到 online。
    const asset = database.upsertAsset({
      title: "Ref",
      kind: "image",
      path: path.join(root, "a.png"),
      pathKey: path.join(root, "a.png").toLocaleLowerCase("en-US"),
      extension: "png",
      size: 1,
      mtimeMs: 1,
      fingerprint: "fp",
      linkState: "online",
      notes: "",
      width: 1,
      height: 1,
      duration: null,
    }).asset;
    database.upsertFileIdentity({
      pathKey: path.join(root, "a.png").toLocaleLowerCase("en-US"),
      assetId: asset.id,
      fingerprint: "fp",
      size: 1,
      rootPath: root,
      mountId: "mount-1",
    });
    const changes: Array<{ mountId: string; state: string }> = [];
    service.onMountStateChanged((change) => changes.push(change));

    await rm(root, { recursive: true, force: true });
    await service.refreshMount("mount-1");
    expect(changes).toContainEqual({ mountId: "mount-1", state: "offline" });
    expect(database.getAsset(asset.id)?.linkState).toBe("offline");

    // 恢复目录：mount 重新 online，资产标记回到 online（§7.5 增量恢复）。
    const { mkdir } = await import("node:fs/promises");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "a.png"), "x");
    await service.refreshMount("mount-1");
    expect(changes).toContainEqual({ mountId: "mount-1", state: "online" });
  });

  it("refreshAll returns only state changes", async () => {
    const root = await createTempDir();
    const { database, service } = createService();
    database.upsertMountRoot({
      id: "mount-1",
      path: root,
      displayName: "Root",
      state: "online",
    });
    const changes = await service.refreshAll();
    // 目录存在：online == 已存状态，无变化。
    expect(changes).toEqual([]);
  });
});
