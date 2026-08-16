/**
 * 引用集合 IPC（FND-003，§6）。
 *
 * 所有输入先经共享 Zod schema 校验（§12.1/§9.1 精神）；Renderer 不直接访问
 * 文件系统或集合仓储，只能通过这里的最小 Preload API 操作。
 * 变更通过 `collections:changed` 广播（幂等事件，无载荷敏感信息）。
 */
import { z } from "zod";
import type { RefCanvasDatabase } from "../persistence/database";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { assertAbsoluteLocalPath } from "../platform/local-path-security";
import type { WriteAccessController } from "../platform/write-access-controller";

const collectionIdSchema = z.string().min(1).max(64);
const collectionNameSchema = z.string().trim().min(1).max(256);
const pathSchemaLocal = z.string().min(1).max(32_768);

const createCollectionSchema = z.object({
  parentId: z.string().min(1).max(64).nullable().optional(),
  name: collectionNameSchema,
});

const updateCollectionSchema = z.object({
  id: collectionIdSchema,
  patch: z.object({
    name: collectionNameSchema.optional(),
    parentId: z.string().min(1).max(64).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
  }),
});

const deleteCollectionSchema = z.object({
  id: collectionIdSchema,
  recursive: z.boolean(),
});

const addPathsSchema = z.object({
  collectionId: collectionIdSchema,
  paths: z.array(pathSchemaLocal).min(1).max(10_000),
});

const removeItemsSchema = z.object({
  collectionId: collectionIdSchema,
  itemIds: z.array(collectionIdSchema).min(1).max(10_000),
});

const relinkSchema = z.object({
  itemId: collectionIdSchema,
  path: pathSchemaLocal,
  confirmFingerprintChange: z.boolean(),
});

const exportSchema = z.object({
  collectionId: collectionIdSchema,
  targetDirectory: pathSchemaLocal,
  jobId: z.string().min(1).max(256).optional(),
});

const exportJobIdSchema = z.string().min(1).max(256);

export interface CollectionsIpcDependencies {
  getDatabase(): RefCanvasDatabase;
  /** 变更广播（index.ts 注入 broadcastAll）。 */
  notifyCollectionsChanged(): void;
  windowForSender?(event: IpcMainInvokeEvent): BrowserWindow;
  writeAccess?: WriteAccessController;
}

export function registerCollectionsIpc(
  ipc: SecureIpcRegistrar,
  dependencies: CollectionsIpcDependencies,
): void {
  const service = () => dependencies.getDatabase().collectionService();

  ipc.handle("collections:list", () => service().list());

  ipc.handle("collections:create", (input) => {
    const parsed = createCollectionSchema.parse(input);
    const created = service().create({
      parentId: parsed.parentId ?? null,
      name: parsed.name,
    });
    dependencies.notifyCollectionsChanged();
    return created;
  });

  ipc.handle("collections:update", (input) => {
    const parsed = updateCollectionSchema.parse(input);
    const updated = service().update(parsed.id, parsed.patch);
    dependencies.notifyCollectionsChanged();
    return updated;
  });

  ipc.handle("collections:delete", (input) => {
    const parsed = deleteCollectionSchema.parse(input);
    service().delete(parsed.id, { recursive: parsed.recursive });
    dependencies.notifyCollectionsChanged();
    return undefined;
  });

  ipc.handle("collections:list-items", (collectionId) => {
    const parsed = collectionIdSchema.parse(collectionId);
    return service().listItems(parsed);
  });

  ipc.handle("collections:add-paths", async (input) => {
    const parsed = addPathsSchema.parse(input);
    const result = await service().addPathsDetailed(
      parsed.collectionId,
      parsed.paths,
    );
    dependencies.notifyCollectionsChanged();
    return result;
  });

  ipc.handle("collections:remove-items", (input) => {
    const parsed = removeItemsSchema.parse(input);
    service().removeItems(parsed.collectionId, parsed.itemIds);
    dependencies.notifyCollectionsChanged();
    return undefined;
  });

  ipc.handle("collections:resolve", async (collectionId) => {
    const parsed = collectionIdSchema.parse(collectionId);
    const result = await service().resolveCollection(parsed);
    dependencies.notifyCollectionsChanged();
    return result;
  });

  ipc.handle("collections:relink", async (input) => {
    const parsed = relinkSchema.parse(input);
    const item = await service().relink(
      parsed.itemId,
      parsed.path,
      parsed.confirmFingerprintChange,
    );
    dependencies.notifyCollectionsChanged();
    return item;
  });

  ipc.handleWithEvent("collections:export", async (event, input) => {
    const parsed = exportSchema.parse(input);
    if (!dependencies.writeAccess || !dependencies.windowForSender) {
      throw new Error("WRITE_AUTHORIZATION_UNAVAILABLE");
    }
    const [targetDirectory] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [
        { path: assertAbsoluteLocalPath(parsed.targetDirectory), mode: "destination" },
      ],
    );
    return service().export(parsed.collectionId, targetDirectory, {
      jobId: parsed.jobId,
    });
  });

  ipc.handle("collections:cancel-export", (jobId) => {
    const parsed = exportJobIdSchema.parse(jobId);
    return service().cancelExport(parsed);
  });
}
