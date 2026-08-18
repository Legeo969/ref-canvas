import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Unzip,
  UnzipInflate,
  Zip,
  ZipDeflate,
} from "fflate";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryManager } from "./library-manager";
import { databasePathFor } from "./library-manager";
import { defaultRemapRules, type PathRemapRule } from "./path-remap";
import { DATABASE_SCHEMA_VERSION } from "../persistence/repositories/migration-repository";

/** Bundle 格式版本。 */
export const BUNDLE_FORMAT_VERSION = 1;

/** bundle 内固定路径。 */
const BUNDLE_DB = "refcanvas.db";
const BUNDLE_MANIFEST = "bundle.json";
const BUNDLE_THUMBNAILS = "cache/thumbnails";

export interface BundleManifest {
  format: "refcanvas-bundle";
  version: number;
  schemaVersion: number;
  exportedAt: string;
  /** 导出机器的已知根路径集合（watch_roots + mount_roots）。 */
  pathRoots: string[];
  /** managed store 是否随 bundle 携带。 */
  includesManaged: boolean;
  /** 是否携带缩略图缓存。 */
  includesThumbnails: boolean;
}

export interface ExportBundleResult {
  path: string;
  size: number;
  manifest: BundleManifest;
}

export interface BundleServiceDependencies {
  getDatabase(): RefCanvasDatabase;
  getLibraryManager(): LibraryManager;
  /** 缩略图缓存根目录（`<userData>/cache/thumbnails`）。 */
  getThumbnailCacheDirectory(): string;
  /** 预览缓存索引（可选；用于收集有效缩略图文件名）。 */
  getPreviewCacheIndexFilenames?(): string[];
}

async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string, relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), `${relative}/${entry.name}`);
      } else if (entry.isFile()) {
        result.push(relative ? `${relative}/${entry.name}` : entry.name);
      }
    }
  };
  await visit(root, "");
  return result;
}

/** 流式解压 ZIP 到内存 map（bundle 规模可接受；不用于超大单文件）。 */
async function unzipToMap(
  data: Uint8Array,
): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = (file) => {
      const bufs: Buffer[] = [];
      file.ondata = (err, chunk, final) => {
        if (err) {
          reject(err);
          return;
        }
        if (chunk) bufs.push(Buffer.from(chunk));
        if (final) entries.set(file.name, Buffer.concat(bufs));
      };
      file.start();
    };
    try {
      unzip.push(data, true);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
  return entries;
}

/**
 * SPEC-2 库可移植性服务：整机库打包导出 / 导入（含路径重映射）。
 */
export class BundleService {
  constructor(private readonly dependencies: BundleServiceDependencies) {}

  /**
   * 导出整个库为 `.refcanvas-bundle`（fflate 流式 zip）：
   * - `refcanvas.db`：主库快照（db.backup 保证一致性）
   * - `cache/thumbnails/**`：有效缩略图
   * - `bundle.json`：格式版本、schema 版本、导出根集合、时间戳
   */
  async exportBundle(targetDirectory: string, baseName: string): Promise<ExportBundleResult> {
    const database = this.dependencies.getDatabase();
    const libraryManager = this.dependencies.getLibraryManager();
    const entry = libraryManager.currentEntry();
    if (!entry) throw new Error("BUNDLE_ENTRY_UNAVAILABLE");
    const thumbnailsRoot = this.dependencies.getThumbnailCacheDirectory();

    // 收集导出根（watch_roots + mount_roots）。
    const watchRoots = database.listWatchRoots().map((root) => root.path);
    const mountRoots = database.listMountRoots().map((root) => root.path);
    const pathRoots = [...new Set([...watchRoots, ...mountRoots])];

    // 收集有效缩略图文件（按 preview 索引 + 目录扫描兜底）。
    const indexedFilenames = new Set(
      this.dependencies.getPreviewCacheIndexFilenames?.() ?? [],
    );
    const thumbnailFiles = existsSync(thumbnailsRoot)
      ? (await walkFiles(thumbnailsRoot)).filter(
          (relative) =>
            indexedFilenames.size === 0 ||
            indexedFilenames.has(path.join(thumbnailsRoot, relative)) ||
            // 目录内文件（board/directory/supreme 子目录）始终保留。
            relative.includes("/"),
        )
      : [];

    const manifest: BundleManifest = {
      format: "refcanvas-bundle",
      version: BUNDLE_FORMAT_VERSION,
      schemaVersion: DATABASE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      pathRoots,
      includesManaged: false,
      includesThumbnails: thumbnailFiles.length > 0,
    };

    // 流式写 zip 到临时文件。
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "refcanvas-bundle-"));
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const zip = new Zip((err, dat, final) => {
        if (err) {
          reject(err);
          return;
        }
        chunks.push(Buffer.from(dat));
        if (final) resolve(Buffer.concat(chunks));
      });
      const addBuffer = (name: string, content: Buffer): void => {
        const file = new ZipDeflate(name);
        file.ondata = (err) => {
          if (err) reject(err);
        };
        zip.add(file);
        file.push(content, true);
      };
      // bundle.json
      addBuffer(BUNDLE_MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
      // 主库快照
      const dbSnapshot = path.join(tmpDir, "db-snapshot.db");
      void (async () => {
        try {
          await database.backupTo(dbSnapshot);
          const dbData = await readFile(dbSnapshot);
          addBuffer(BUNDLE_DB, dbData);
          // 缩略图
          for (const relative of thumbnailFiles) {
            const content = await readFile(path.join(thumbnailsRoot, relative));
            addBuffer(`${BUNDLE_THUMBNAILS}/${relative}`, content);
          }
          zip.end();
        } catch (error) {
          reject(error);
        }
      })();
    });
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);

    // 原子写目标。
    await mkdir(targetDirectory, { recursive: true });
    const safeBase = baseName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 128) || "library";
    let target = path.join(targetDirectory, `${safeBase}.refcanvas-bundle`);
    let index = 2;
    while (existsSync(target)) {
      target = path.join(targetDirectory, `${safeBase} (${index}).refcanvas-bundle`);
      index += 1;
    }
    await writeFile(target, zipBuffer);
    const info = await stat(target);
    return { path: target, size: info.size, manifest };
  }

  /**
   * 导入 bundle：解包到目标 userData，写库 + 缩略图 + 待重映射标记，
   * 然后重启（仿 backups:restore）。重启后启动流程读取标记并执行
   * `database.remapPaths(rules)`（linked 资产路径重映射），最后清标记。
   *
   * 返回待重映射的根规则，供启动流程使用。
   */
  async importBundle(
    bundlePath: string,
    rootRules: PathRemapRule[],
  ): Promise<{ pendingRemapFile: string; rules: PathRemapRule[] }> {
    const libraryManager = this.dependencies.getLibraryManager();
    const entry = libraryManager.currentEntry();
    if (!entry) throw new Error("BUNDLE_ENTRY_UNAVAILABLE");
    const data = await readFile(bundlePath);
    const entries = await unzipToMap(new Uint8Array(data));
    if (!entries.has(BUNDLE_MANIFEST)) throw new Error("BUNDLE_MISSING_MANIFEST");
    const manifest = JSON.parse(
      entries.get(BUNDLE_MANIFEST)!.toString("utf8"),
    ) as BundleManifest;
    if (manifest.format !== "refcanvas-bundle") {
      throw new Error("BUNDLE_INVALID_FORMAT");
    }
    if (manifest.version > BUNDLE_FORMAT_VERSION) {
      throw new Error("BUNDLE_TOO_NEW");
    }

    // 解析根映射：manifest.pathRoots 为默认建议，rootRules 是用户确认/编辑的。
    const rules = rootRules.length
      ? rootRules
      : defaultRemapRules(manifest.pathRoots);
    const dbData = entries.get(BUNDLE_DB);
    if (!dbData) throw new Error("BUNDLE_MISSING_DB");

    // 备份现有主库后替换（可回滚）。
    const dbPath = databasePathFor(entry);
    const rollback = `${dbPath}.before-import`;
    const { copyFile } = await import("node:fs/promises");
    if (existsSync(dbPath)) {
      await copyFile(dbPath, rollback).catch(() => undefined);
    }
    await writeFile(dbPath, dbData);
    await writeFile(`${dbPath}-wal`, Buffer.alloc(0)).catch(() => undefined);
    await writeFile(`${dbPath}-shm`, Buffer.alloc(0)).catch(() => undefined);

    // 恢复缩略图。
    const thumbnailsRoot = this.dependencies.getThumbnailCacheDirectory();
    await mkdir(thumbnailsRoot, { recursive: true });
    for (const [name, content] of entries) {
      if (!name.startsWith(`${BUNDLE_THUMBNAILS}/`)) continue;
      const relative = name.slice(BUNDLE_THUMBNAILS.length + 1);
      const target = path.resolve(thumbnailsRoot, relative);
      const root = path.resolve(thumbnailsRoot) + path.sep;
      if (target !== path.resolve(thumbnailsRoot) && !target.startsWith(root)) {
        continue; // 防路径穿越。
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }

    // 写待重映射标记：重启后启动流程据此执行路径重映射。
    const userData = path.dirname(dbPath);
    const pendingRemapFile = path.join(userData, "pending-bundle-remap.json");
    await writeFile(
      pendingRemapFile,
      JSON.stringify({ rules, importedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    return { pendingRemapFile, rules };
  }
}
