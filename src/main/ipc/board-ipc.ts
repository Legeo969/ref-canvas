import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AssetRecord, BoardDocument } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { boardDocumentSchema } from "./board-schema";
import { idSchema, pathSchema } from "./schemas";

interface BoardIpcDependencies {
  copyProjectAsset(assetId: string, destination: string): Promise<unknown>;
  getDatabase(): RefCanvasDatabase;
  getMainWindow(): BrowserWindow | null;
  openBoardWindow(boardId: string): void;
  pngDataUrlToBuffer(dataUrl: string): Buffer;
  relinkBoardAsset(assetId: string, filename: string): Promise<AssetRecord>;
  windowForSender(event: IpcMainInvokeEvent): BrowserWindow;
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
  ipc.handle("boards:save", (id, document) =>
    database().saveBoard(
      idSchema.parse(id),
      boardDocumentSchema.parse(document) as BoardDocument,
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
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && window !== dependencies.getMainWindow()) window.close();
    return true;
  });
  ipc.handle("boards:get-assets", (id) => {
    const assetIds = database().getBoardAssetIds(idSchema.parse(id));
    return assetIds
      .map((assetId) => database().getAsset(assetId))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
  });
  ipc.handle("boards:resolve-references", (id) => {
    const assetIds = database().getBoardAssetIds(idSchema.parse(id));
    return assetIds.map((assetId) => {
      const asset = database().getAsset(assetId);
      if (!asset) {
        return { assetId, path: null, state: "missing" as const };
      }
      if (asset.linkState === "offline") {
        return { assetId, path: asset.path, state: "offline" as const };
      }
      if (asset.linkState === "ambiguous") {
        return { assetId, path: asset.path, state: "ambiguous" as const };
      }
      return {
        assetId,
        path: asset.path,
        state: asset.linkState === "online" ? ("online" as const) : ("missing" as const),
      };
    });
  });
  ipc.handle("boards:relink-reference", async (id, assetId, filename) => {
    const parsedId = idSchema.parse(id);
    const parsedAssetId = idSchema.parse(assetId);
    if (!database().getBoardAssetIds(parsedId).includes(parsedAssetId)) {
      throw new Error("BOARD_ASSET_NOT_REFERENCED");
    }
    const asset = await dependencies.relinkBoardAsset(
      parsedAssetId,
      path.resolve(pathSchema.parse(filename)),
    );
    return {
      assetId: parsedAssetId,
      path: asset.path,
      state: asset.linkState === "online" ? ("online" as const) : ("missing" as const),
    };
  });
  ipc.handleWithEvent("boards:export-package", async (event, id, options) => {
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
    await writeFile(
      result.filePath,
      JSON.stringify(loaded.document, null, 2),
      "utf8",
    );
    if (parsedOptions.embedAssets) {
      const bundleDirectory = `${result.filePath}.files`;
      await mkdir(bundleDirectory, { recursive: true });
      const assets = [];
      for (const assetId of database().getBoardAssetIds(parsedId)) {
        assets.push(
          await dependencies.copyProjectAsset(assetId, bundleDirectory),
        );
      }
      await writeFile(
        path.join(bundleDirectory, "manifest.json"),
        JSON.stringify(
          {
            format: "refcanvas-package",
            version: 1,
            board: loaded.summary,
            assets,
            document: loaded.document,
            embedded: true,
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    return result.filePath;
  });
  ipc.handleWithEvent("boards:export-json", async (event, id) => {
    const loaded = database().loadBoard(idSchema.parse(id));
    if (!loaded) throw new Error("BOARD_NOT_FOUND");
    const result = await dialog.showSaveDialog(dependencies.windowForSender(event), {
      title: "导出白板 JSON",
      defaultPath: path.join(
        app.getPath("documents"),
        `${loaded.summary.title}.refcanvas`,
      ),
      filters: [{ name: "RefCanvas 项目", extensions: ["refcanvas"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(
      result.filePath,
      JSON.stringify(loaded.document, null, 2),
      "utf8",
    );
    return result.filePath;
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
    await writeFile(
      result.filePath,
      dependencies.pngDataUrlToBuffer(z.string().parse(dataUrl)),
    );
    return result.filePath;
  });
}
