import { app, BrowserWindow, dialog, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { AssetRecord, BoardDocument } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { assertAbsoluteLocalPath } from "../platform/local-path-security";
import type { WriteAccessController } from "../platform/write-access-controller";
import type { BoardReferenceService } from "../services/board-reference-service";
import { boardDocumentSchema } from "./board-schema";
import { importBoardPackage } from "../services/board-import-service";
import { idSchema, pathSchema } from "./schemas";

interface BoardIpcDependencies {
  copyProjectAsset(
    assetId: string,
    destination: string,
  ): Promise<{ id: string; source: string; relativePath: string } | null>;
  materializePath(filename: string): Promise<{ asset: { id: string } }>;
  getBoardReferences(): BoardReferenceService;
  getDatabase(): RefCanvasDatabase;
  getMainWindow(): BrowserWindow | null;
  notifyBoardFlushComplete(
    event: IpcMainEvent | IpcMainInvokeEvent,
    saved: boolean,
  ): void;
  openBoardWindow(boardId: string): void;
  pngDataUrlToBuffer(dataUrl: string): Buffer;
  relinkBoardAsset(assetId: string, filename: string): Promise<AssetRecord>;
  windowForSender(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow;
  writeAccess: WriteAccessController;
}

export function registerBoardIpc(
  ipc: SecureIpcRegistrar,
  dependencies: BoardIpcDependencies,
): void {
  const database = () => dependencies.getDatabase();

  ipc.handle("boards:list", () => database().listBoards());
  ipc.handle("boards:create", (title) =>
    database().createBoard(
      z.string().trim().min(1).max(120).optional().parse(title),
    ),
  );
  ipc.handle("boards:rename", (id, title) =>
    database().renameBoard(
      idSchema.parse(id),
      z.string().trim().min(1).max(120).parse(title),
    ),
  );
  ipc.handle("boards:delete", (id) =>
    database().deleteBoard(idSchema.parse(id)),
  );
  ipc.handle("boards:load", (id) => database().loadBoard(idSchema.parse(id)));
  ipc.handle("boards:save", (id, document, revision) =>
    database().saveBoard(
      idSchema.parse(id),
      boardDocumentSchema.parse(document) as BoardDocument,
      z.number().int().positive().parse(revision),
    ),
  );
  ipc.handle("boards:touch", (id) => {
    database().touchBoard(idSchema.parse(id));
  });
  ipc.handle("boards:recent", () => database().recentBoards());
  ipc.handle("boards:open-window", (id) => {
    const boardId = idSchema.parse(id);
    if (!database().loadBoard(boardId)) throw new Error("BOARD_NOT_FOUND");
    dependencies.openBoardWindow(boardId);
    return true;
  });
  ipc.handleWithEvent("boards:close-window", (event) => {
    const window = dependencies.windowForSender(event);
    if (window !== dependencies.getMainWindow()) window.close();
    return true;
  });
  ipc.on("boards:flush-complete", (event, saved) => {
    dependencies.notifyBoardFlushComplete(event, z.boolean().parse(saved));
  });
  ipc.handle("boards:get-assets", (id) => {
    const assetIds = database().getBoardAssetIds(idSchema.parse(id));
    return assetIds
      .map((assetId) => database().getAsset(assetId))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
  });
  ipc.handle("boards:resolve-references", (id) =>
    dependencies.getBoardReferences().resolveReferences(idSchema.parse(id)),
  );
  ipc.handle("boards:relink-reference", async (id, assetId, filename) => {
    const parsedId = idSchema.parse(id);
    const parsedAssetId = idSchema.parse(assetId);
    if (!database().getBoardAssetIds(parsedId).includes(parsedAssetId)) {
      throw new Error("BOARD_ASSET_NOT_REFERENCED");
    }
    const asset = await dependencies.relinkBoardAsset(
      parsedAssetId,
      assertAbsoluteLocalPath(pathSchema.parse(filename)),
    );
    return {
      assetId: parsedAssetId,
      path: asset.path,
      state: asset.linkState === "online" ? ("online" as const) : ("missing" as const),
    };
  });
  const exportBoardPackage = async (
    event: Parameters<Parameters<SecureIpcRegistrar["handleWithEvent"]>[1]>[0],
    id: string,
    options: unknown,
  ): Promise<{ path: string; skippedAssets: number } | null> => {
    const parsedId = idSchema.parse(id);
    const loaded = database().loadBoard(parsedId);
    if (!loaded) throw new Error("BOARD_NOT_FOUND");
    const parsedOptions = z
      .object({ embedAssets: z.boolean() })
      .parse(options ?? { embedAssets: false });
    const result = await dialog.showSaveDialog(dependencies.windowForSender(event), {
      title: "导出白板包",
      defaultPath: path.join(
        app.getPath("documents"),
        `${loaded.summary.title}.refcanvas`,
      ),
      filters: [{ name: "RefCanvas 项目", extensions: ["refcanvas"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const [destination] = await dependencies.writeAccess.authorizePickerSelection([
      { path: result.filePath, mode: "destination" },
    ]);
    if (!parsedOptions.embedAssets) {
      await writeFile(
        destination,
        JSON.stringify(loaded.document, null, 2),
        "utf8",
      );
      return { path: destination, skippedAssets: 0 };
    }
    const bundleDirectory = await mkdtemp(
      path.join(os.tmpdir(), "refcanvas-board-package-"),
    );
    let skippedAssets = 0;
    try {
      const assets: Array<{ id: string; source: string; relativePath: string }> = [];
      for (const assetId of database().getBoardAssetIds(parsedId)) {
        const copied = await dependencies.copyProjectAsset(assetId, bundleDirectory);
        if (copied) assets.push(copied);
        else skippedAssets += 1;
      }
      const files: Array<{ relativePath: string; dataBase64: string }> = [];
      const pending = [bundleDirectory];
      while (pending.length) {
        const directory = pending.pop()!;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          // 基准必须是「当前遍历的目录」而不是打包根：资产落在
          // assets/<assetId>/ 子目录里，用根目录拼会得到不存在的路径
          // （ENOENT scandir → 整个导出失败）。
          const filename = path.resolve(directory, entry.name);
          const relative = path.relative(bundleDirectory, filename);
          if (
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
          ) {
            continue;
          }
          if (entry.isDirectory()) {
            pending.push(filename);
          } else if (entry.isFile()) {
            files.push({
              relativePath: relative,
              dataBase64: (await readFile(filename)).toString("base64"),
            });
          }
        }
      }
      await writeFile(
        destination,
        JSON.stringify(
          {
            format: "refcanvas-package",
            version: 2,
            board: loaded.summary,
            assets,
            document: loaded.document,
            files,
          },
          null,
          2,
        ),
        "utf8",
      );
    } finally {
      // 临时目录清理失败（Windows 上文件句柄延迟释放导致 EBUSY 很常见）
      // 绝不能覆盖已经成功的导出结果。
      await rm(bundleDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    return { path: destination, skippedAssets };
  };
  ipc.handleWithEvent("boards:export-package", async (event, id, options) => {
    try {
      return await exportBoardPackage(event, z.string().parse(id), options);
    } catch (error) {
      // 把真实原因抛给渲染进程：UI 直接显示可诊断的文案，
      // 不再是一句无从排查的「导出失败」。
      const message = error instanceof Error ? error.message : String(error);
      console.error("[board] export-package failed", error);
      throw new Error(`EXPORT_PACKAGE_FAILED: ${message}`, { cause: error });
    }
  });
  // boards:export-json 已并入 boards:export-package（embedAssets:false 轻量档，产出同构）。
  ipc.handleWithEvent("boards:import-project", async (event) => {
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: "导入 RefCanvas 项目",
      properties: ["openFile"],
      filters: [
        { name: "RefCanvas 项目", extensions: ["refcanvas"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const imported = await importBoardPackage(result.filePaths[0], {
      getDatabase: database,
      materializePath: dependencies.materializePath,
    });
    return {
      boardId: imported.boardId,
      title: imported.title,
      assetsImported: imported.assetsImported,
    };
  });
  ipc.handleWithEvent("boards:export-png", async (event, id, dataUrl) => {
    const loaded = database().loadBoard(idSchema.parse(id));
    if (!loaded) throw new Error("BOARD_NOT_FOUND");
    const result = await dialog.showSaveDialog(dependencies.windowForSender(event), {
      title: "导出白板 PNG",
      defaultPath: path.join(app.getPath("pictures"), `${loaded.summary.title}.png`),
      filters: [{ name: "PNG 图片", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const [destination] = await dependencies.writeAccess.authorizePickerSelection([
      { path: result.filePath, mode: "destination" },
    ]);
    await writeFile(
      destination,
      dependencies.pngDataUrlToBuffer(z.string().parse(dataUrl)),
    );
    return destination;
  });
}
