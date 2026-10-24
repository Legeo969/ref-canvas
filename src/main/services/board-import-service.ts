import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BoardDocument, BoardSummary } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import {
  rewriteBoardAssetId,
  toBoardV2,
} from "../persistence/repositories/boards-repository";
import { boardDocumentSchema } from "../ipc/board-schema";

export interface BoardImportResult {
  boardId: string;
  title: string;
  assetsImported: number;
}

export interface BoardImportServiceDependencies {
  getDatabase(): RefCanvasDatabase;
  /** 将磁盘文件入索引并返回新 assetId（同路径复用既有 asset）。 */
  materializePath(filename: string): Promise<{ asset: { id: string } }>;
}

const packageSchema = z.object({
  format: z.literal("refcanvas-package"),
  version: z.literal(2),
  board: z.object({ title: z.string().trim().min(1).max(120) }),
  assets: z.array(
    z.object({
      id: z.string().min(1).max(128),
      relativePath: z.string().min(1).max(4_096),
    }),
  ),
  files: z.array(
    z.object({
      relativePath: z.string().min(1).max(4_096),
      dataBase64: z.string(),
    }),
  ),
  document: boardDocumentSchema,
});

const projectManifestSchema = z.object({
  format: z.literal("refcanvas-project"),
  version: z.literal(1),
  board: z.object({ title: z.string().trim().min(1).max(120) }),
  assets: z.array(
    z.object({
      id: z.string().min(1).max(128),
      source: z.string().optional(),
      relativePath: z.string().min(1).max(4_096),
    }),
  ),
});

/** 相对路径不得越出导入根（目录遍历拒绝）。 */
function assertInsideRoot(root: string, relativePath: string): void {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("BOARD_PACKAGE_PATH_OUTSIDE_ROOT");
  }
}

/**
 * 导入一个 RefCanvas 项目文件，三种输入统一入口：
 * 1. 自包含 .refcanvas 包（format: refcanvas-package v2，资产 base64 内嵌）
 * 2. 纯 JSON 白板文档（旧「导出 JSON」产物，向后兼容）
 * 3. .refcanvas-project 目录（「打包参考板及源文件」产物：board.json +
 *    manifest.json + assets/ 源文件副本）
 *
 * 资产一律通过 materializePath 重新索引（磁盘唯一真相：同路径复用
 * assetId），白板引用经 rewriteBoardAssetId 重写后入库为新 board
 * （重名不阻断，与命令行导入同语义）。
 */
export async function importBoardPackage(
  filename: string,
  dependencies: BoardImportServiceDependencies,
): Promise<BoardImportResult> {
  const database = dependencies.getDatabase();
  const info = await stat(filename);
  const basename = path.basename(filename);
  let title = basename.replace(/\.refcanvas(-project)?$/i, "");
  let document: BoardDocument;
  let assetsImported = 0;

  if (info.isDirectory()) {
    // ── .refcanvas-project 目录 ──
    // （目录格式已停止导出——导出统一为自包含单文件包；此分支仅保留
    //   导入兼容，历史 collectProject 产物仍可被打开。）
    if (!basename.toLowerCase().endsWith(".refcanvas-project")) {
      throw new Error("BOARD_IMPORT_UNKNOWN_DIRECTORY");
    }
    const [manifestRaw, boardRaw] = await Promise.all([
      readFile(path.join(filename, "manifest.json"), "utf8"),
      readFile(path.join(filename, "board.json"), "utf8"),
    ]);
    const manifest = projectManifestSchema.parse(JSON.parse(manifestRaw));
    document = boardDocumentSchema.parse(JSON.parse(boardRaw)) as BoardDocument;
    title = manifest.board.title;
    let migrated = toBoardV2(document);
    for (const asset of manifest.assets) {
      assertInsideRoot(filename, asset.relativePath);
      const assetFilename = path.resolve(filename, asset.relativePath);
      const info = await stat(assetFilename).catch(() => null);
      if (!info?.isFile()) continue; // 缺失资产不阻断：保留引用，由断链定位处理
      const materialized = await dependencies.materializePath(assetFilename);
      migrated = rewriteBoardAssetId(migrated, asset.id, materialized.asset.id);
      assetsImported += 1;
    }
    document = migrated;
  } else {
    // ── 单文件：自包含包或纯 JSON ──
    const raw = JSON.parse(await readFile(filename, "utf8")) as unknown;
    const packageResult = packageSchema.safeParse(raw);
    if (packageResult.success) {
      const extractionRoot = path.join(
        path.dirname(filename),
        `${path.basename(filename, ".refcanvas")}.assets-${Date.now()}`,
      );
      await mkdir(extractionRoot, { recursive: true });
      for (const file of packageResult.data.files) {
        assertInsideRoot(extractionRoot, file.relativePath);
        const target = path.resolve(extractionRoot, file.relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(file.dataBase64, "base64"));
      }
      let migrated = toBoardV2(packageResult.data.document as BoardDocument);
      for (const asset of packageResult.data.assets) {
        assertInsideRoot(extractionRoot, asset.relativePath);
        const assetFilename = path.resolve(extractionRoot, asset.relativePath);
        const materialized = await dependencies.materializePath(assetFilename);
        migrated = rewriteBoardAssetId(migrated, asset.id, materialized.asset.id);
        assetsImported += 1;
      }
      document = migrated;
      title = packageResult.data.board.title;
    } else {
      document = boardDocumentSchema.parse(raw) as BoardDocument;
    }
  }

  const summary: BoardSummary = database.createBoard(title);
  database.saveBoard(summary.id, document);
  return { boardId: summary.id, title, assetsImported };
}
