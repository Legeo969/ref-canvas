import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { LibraryService } from "../../../src/main/services/library-service";
import { BoardReferenceService } from "../../../src/main/services/board-reference-service";
import type { BoardDocumentV3 } from "../../../src/shared/contracts";

const temporaryDirectories: string[] = [];

async function withTemp(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-board-"));
  temporaryDirectories.push(directory);
  return directory;
}

function boardDocumentWith(assetId: string): BoardDocumentV3 {
  return {
    schemaVersion: 3,
    canvas: {
      version: "5.3.0",
      objects: [
        {
          type: "image",
          left: 100,
          top: 120,
          data: { type: "asset", assetId },
        },
      ],
    },
    viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
    guides: { x: [], y: [] },
    appearance: {
      backgroundColor: "#101513",
      gridVisible: true,
      gridSize: 32,
    },
    canvasMode: { locked: false, grayscale: false, gridStyle: "line" },
    windowMode: "normal",
    sampling: "bilinear",
    exportSettings: { format: "png", embedAssets: false },
  };
}

/** 建立含一个素材 + 一个 Board 引用的环境。 */
async function scaffold(): Promise<{  root: string;
  database: RefCanvasDatabase;
  service: LibraryService;
  assetId: string;
  boardId: string;
  file: string;
}> {
  const root = await withTemp();
  const file = path.join(root, "concept.png");
  await writeFile(file, Buffer.alloc(4096, 9));
  const database = new RefCanvasDatabase(":memory:");
  const service = new LibraryService(database);
  await service.addWatchRoot(root);
  const { asset } = await service.materializePath(file);
  const board = database.createBoard("测试板");
  database.saveBoard(board.id, boardDocumentWith(asset.id));
  return { root, database, service, assetId: asset.id, boardId: board.id, file };
}

describe("BoardReferenceService（阶段 6：Board V4 引用解析）", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("文件未移动：online，不自动重连", async () => {
    const { database, service, assetId, boardId, file } = await scaffold();
    try {
      const references = new BoardReferenceService(database);
      const [result] = await references.resolveReferences(boardId);
      expect(result.assetId).toBe(assetId);
      expect(result.state).toBe("online");
      expect(result.path).toBe(file);
      expect(result.relinked).toBe(false);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("文件移动且 fingerprint 匹配：自动重连并更新 path", async () => {
    const { root, database, service, assetId, boardId, file } = await scaffold();
    try {
      const movedDirectory = path.join(root, "moved");
      await mkdir(movedDirectory);
      const movedFile = path.join(movedDirectory, "concept.png");
      // Windows 并行 worker 下句柄释放有延迟：rename 同样可能 EBUSY，带短重试。
      await renameWithRetry(file, movedFile);
      // 索引扫描发现新位置（file_identities 新路径记录，无 asset 归属）。
      const asset = database.getAsset(assetId)!;
      const fileStat = await stat(movedFile);
      database.upsertFileIdentity({
        pathKey: path.normalize(movedFile).toLocaleLowerCase("en-US"),
        assetId: "",
        fingerprint: asset.fingerprint,
        size: fileStat.size,
        rootPath: root,
        mountId: null,
      });

      const references = new BoardReferenceService(database);
      const [result] = await references.resolveReferences(boardId);
      expect(result.state).toBe("online");
      expect(result.relinked).toBe(true);
      expect(result.path).toBe(movedFile);
      expect(database.getAsset(assetId)!.path).toBe(movedFile);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("文件删除：missing，Board document 不受影响", async () => {
    const { database, service, boardId, file } = await scaffold();
    try {
      // Windows 并行 worker 下句柄释放有延迟（EBUSY），与多候选用例同款重试。
      await rmWithRetry(file);
      const references = new BoardReferenceService(database);
      const [result] = await references.resolveReferences(boardId);
      expect(result.state).toBe("missing");
      expect(result.path).toBeNull();
      expect(result.relinked).toBe(false);
      expect(database.getBoardAssetIds(boardId)).toHaveLength(1);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("多候选：ambiguous + candidates（不自动选择）", async () => {
    const { root, database, service, assetId, boardId, file } = await scaffold();
    try {
      // 原文件先删除（触发 fingerprint 搜索）。Windows 并行 worker 下文件句柄
      // 释放有延迟，rm 带短重试（EBUSY 安全）。
      await rmWithRetry(file);
      const content = await stat(file).catch(() => null);
      const fingerprint = database.getAsset(assetId)!.fingerprint;
      const rootPath = path.resolve(root);
      for (const candidate of ["dup_a.png", "dup_b.png"]) {
        const full = path.resolve(rootPath, candidate);
        // 候选文件是固定常量名，仍做根目录边界校验（纵深防御）。
        if (full !== rootPath && !full.startsWith(rootPath + path.sep)) {
          throw new Error("FIXTURE_OUT_OF_DIRECTORY");
        }
        // 候选文件真实存在（磁盘校验只发生在唯一候选时）。
        await writeFile(full, Buffer.alloc(4096, 9));
        const candidateStat = await stat(full);
        database.upsertFileIdentity({
          pathKey: path.normalize(full).toLocaleLowerCase("en-US"),
          assetId: "",
          fingerprint,
          size: candidateStat.size,
          rootPath: root,
          mountId: null,
        });
      }
      void content;
      const references = new BoardReferenceService(database);
      const [result] = await references.resolveReferences(boardId);
      expect(result.state).toBe("ambiguous");
      expect(result.relinked).toBe(false);
      expect(result.candidates).toHaveLength(2);
    } finally {
      await service.close();
      database.close();
    }
  });
});

/** Windows 并行 worker 下句柄释放有延迟：rm 带短重试（EBUSY 安全）。 */
async function rmWithRetry(filename: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(filename, { force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
}

/** Windows 并行 worker 下句柄释放有延迟：rename 带短重试（EBUSY 安全）。 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
}
