/**
 * schema 16/17 引用集合恢复迁移（规格 found-clone.md §6.4）。
 *
 * - v16（修订）：把含数据的旧集合表**归档**为 `_legacy_*_v16`，空表退休；
 *   绝不无条件删除非空集合数据。
 * - v17：新建 `collections` / `collection_items` / `ai_jobs` 表，并在一个
 *   事务内优先从归档表、其次从迁移前快照导入集合数据，校验计数后才提交；
 *   既无归档也无快照时建空表并记录一次性、事实准确的恢复说明。
 *
 * 安全约定（与 migration-repository.ts 一致）：
 * - 所有 SQL 一律为字面量；标识符选择使用白名单分支（`tableKey` 限定
 *   `"collections" | "collection_assets" | "collection_refs" | "collection_sources"`），
 *   绝不把外部输入拼进 SQL 文本。
 * - 带值的 DML 全部使用绑定参数。
 * - 路径连接在 JS 侧用 node:path 完成，SQL 内不做字符串拼接。
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";

/** 迁移步骤上下文（与 migration-repository 的 MigrationContext 兼容）。 */
export interface CollectionMigrationContext {
  migrationBackupDirectory?: string;
}

type LegacyTableKey = "collections" | "collection_assets" | "collection_refs" | "collection_sources";

const LEGACY_TABLE_KEYS: readonly LegacyTableKey[] = [
  "collections",
  "collection_assets",
  "collection_refs",
  "collection_sources",
];

function archiveNameFor(table: LegacyTableKey): string {
  switch (table) {
    case "collections":
      return "_legacy_collections_v16";
    case "collection_assets":
      return "_legacy_collection_assets_v16";
    case "collection_refs":
      return "_legacy_collection_refs_v16";
    case "collection_sources":
      return "_legacy_collection_sources_v16";
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table),
  );
}

function legacyCount(db: Database.Database, table: LegacyTableKey): number {
  // tableKey 是编译期限定的字面量联合，SQL 均为字面量，不会携带外部输入。
  const statement =
    table === "collections"
      ? "SELECT COUNT(*) AS count FROM collections"
      : table === "collection_assets"
        ? "SELECT COUNT(*) AS count FROM collection_assets"
        : table === "collection_refs"
          ? "SELECT COUNT(*) AS count FROM collection_refs"
          : "SELECT COUNT(*) AS count FROM collection_sources";
  const row = db.prepare(statement).get() as { count: number };
  return row.count;
}

function dropLegacyTable(db: Database.Database, table: LegacyTableKey): void {
  if (table === "collections") {
    db.exec("DROP TABLE IF EXISTS collections");
  } else if (table === "collection_assets") {
    db.exec("DROP TABLE IF EXISTS collection_assets");
  } else if (table === "collection_refs") {
    db.exec("DROP TABLE IF EXISTS collection_refs");
  } else {
    db.exec("DROP TABLE IF EXISTS collection_sources");
  }
}

function renameLegacyTable(db: Database.Database, table: LegacyTableKey): void {
  if (table === "collections") {
    db.exec("ALTER TABLE collections RENAME TO _legacy_collections_v16");
  } else if (table === "collection_assets") {
    db.exec(
      "ALTER TABLE collection_assets RENAME TO _legacy_collection_assets_v16",
    );
  } else if (table === "collection_refs") {
    db.exec(
      "ALTER TABLE collection_refs RENAME TO _legacy_collection_refs_v16",
    );
  } else {
    db.exec(
      "ALTER TABLE collection_sources RENAME TO _legacy_collection_sources_v16",
    );
  }
}

/**
 * v16（修订）：归档旧集合表。含数据的表改名保留，空表直接退休。
 * 已由更早构建执行过破坏性 v16 的数据库（无归档表）不受影响，本步骤幂等。
 */
export function archiveLegacyCollections(db: Database.Database): void {
  // 已经具备 v17 物理表、但 user_version 被降级/损坏时，绝不能把当前
  // collections 误当成 v15 旧表归档或删除。让后续 v17 步骤原地校验即可。
  if (tableExists(db, "collection_items")) {
    return;
  }
  for (const table of LEGACY_TABLE_KEYS) {
    if (!tableExists(db, table)) continue;
    const archiveName = archiveNameFor(table);
    if (tableExists(db, archiveName)) {
      // 归档已存在（重跑或降级重试）：直接删除原表，保留归档数据。
      dropLegacyTable(db, table);
      continue;
    }
    if (legacyCount(db, table) > 0) {
      renameLegacyTable(db, table);
    } else {
      dropLegacyTable(db, table);
    }
  }
}

/** 导入完成后各表总数（用于计数校验）。 */
interface RestoredCounts {
  collections: number;
  items: number;
  nonEmptyPaths: number;
}

function currentCounts(db: Database.Database): RestoredCounts {
  const collections = db
    .prepare("SELECT COUNT(*) AS count FROM collections")
    .get() as { count: number };
  const items = db
    .prepare("SELECT COUNT(*) AS count FROM collection_items")
    .get() as { count: number };
  const nonEmpty = db
    .prepare(
      "SELECT COUNT(*) AS count FROM collection_items WHERE last_resolved_path <> ''",
    )
    .get() as { count: number };
  return {
    collections: collections.count,
    items: items.count,
    nonEmptyPaths: nonEmpty.count,
  };
}

/** 从 v16 归档表导入（SQL 全为字面量，值绑定参数，路径在 JS 侧连接）。 */
function importFromArchive(
  db: Database.Database,
  legacyCollections: boolean,
  legacyRefs: boolean,
  legacyAssets: boolean,
): RestoredCounts {
  const expectedCollections = legacyCollections
    ? (db.prepare("SELECT COUNT(*) AS count FROM _legacy_collections_v16").get() as {
        count: number;
      }).count
    : 0;
  const expectedRefs = legacyRefs
    ? (db.prepare("SELECT COUNT(*) AS count FROM _legacy_collection_refs_v16").get() as {
        count: number;
      }).count
    : 0;
  const expectedAssets = legacyAssets
    ? (db.prepare("SELECT COUNT(*) AS count FROM _legacy_collection_assets_v16").get() as {
        count: number;
      }).count
    : 0;
  const expectedRefPaths = legacyRefs
    ? (db.prepare(`
        SELECT COUNT(*) AS count
        FROM _legacy_collection_refs_v16 r
        JOIN mount_roots m ON m.id = r.mount_id
        WHERE r.relative_path IS NOT NULL AND r.relative_path <> ''
      `).get() as { count: number }).count
    : 0;
  const expectedAssetPaths = legacyAssets
    ? (db.prepare(`
        SELECT COUNT(*) AS count
        FROM _legacy_collection_assets_v16 ca
        JOIN assets a ON a.id = ca.asset_id
        WHERE a.path IS NOT NULL AND a.path <> ''
      `).get() as { count: number }).count
    : 0;
  const now = new Date().toISOString();
  if (legacyCollections) {
    // 旧 collections 恒定含 id/title/parent_id/sort_order/created_at。
    db.exec(`
      INSERT INTO collections
        (id, parent_id, name, sort_order, created_at, updated_at)
      SELECT id, parent_id, title, sort_order, created_at, created_at
      FROM _legacy_collections_v16
    `);
  }

  if (legacyRefs) {
    // 旧 collection_refs 恒定含 id/collection_id/mount_id/relative_path/
    // fingerprint/state（v14 与 v15 两版列集相同），无 created_at。
    const mountPaths = new Map(
      (
        db.prepare("SELECT id, path FROM mount_roots").all() as Array<{
          id: string;
          path: string;
        }>
      ).map((row) => [row.id, row.path] as const),
    );
    const rows = db
      .prepare(`
        SELECT id, collection_id, mount_id, relative_path, fingerprint, state
        FROM _legacy_collection_refs_v16
      `)
      .all() as Array<{
      id: string;
      collection_id: string;
      mount_id: string | null;
      relative_path: string | null;
      fingerprint: string | null;
      state: string | null;
    }>;
    const insert = db.prepare(`
      INSERT INTO collection_items
        (id, collection_id, identity_id, mount_id, relative_path,
         last_resolved_path, path_key, fingerprint, state, sort_order,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);
    for (const row of rows) {
      const mountPath = row.mount_id ? mountPaths.get(row.mount_id) : undefined;
      const lastResolvedPath =
        mountPath && row.relative_path
          ? path.join(mountPath, row.relative_path)
          : "";
      const pathKey =
        lastResolvedPath !== ""
          ? lastResolvedPath.toLocaleLowerCase("en-US")
          : row.id;
      insert.run(
        randomUUID(),
        row.collection_id,
        null,
        row.mount_id,
        row.relative_path,
        lastResolvedPath,
        pathKey,
        row.fingerprint,
        row.state ?? "resolved",
        now,
        now,
      );
    }
  }

  if (legacyAssets) {
    // collection_assets 只有 (collection_id, asset_id)：经 assets 表回填路径。
    db.prepare(`
      INSERT INTO collection_items
        (id, collection_id, identity_id, mount_id, relative_path,
         last_resolved_path, path_key, fingerprint, state, sort_order,
         created_at, updated_at)
      SELECT lower(hex(randomblob(16))), ca.collection_id, NULL, NULL, NULL,
        COALESCE(a.path, ''), COALESCE(a.path_key, ca.asset_id),
        a.fingerprint, 'resolved', 0, ?, ?
      FROM _legacy_collection_assets_v16 ca
      LEFT JOIN assets a ON a.id = ca.asset_id
    `).run(now, now);
  }

  return {
    collections: expectedCollections,
    items: expectedRefs + expectedAssets,
    nonEmptyPaths: expectedRefPaths + expectedAssetPaths,
  };
}

/** 从迁移备份目录中最新 migrate-v15-to-v16 快照导入（值全部绑定参数）。 */
function importFromSnapshot(
  db: Database.Database,
  snapshotPath: string,
): RestoredCounts {
  const snapshot = new Database(snapshotPath, { readonly: true });
  try {
    const legacyCollections = tableExists(snapshot, "collections");
    const legacyRefs = tableExists(snapshot, "collection_refs");
    const legacyAssets = tableExists(snapshot, "collection_assets");
    if (!legacyCollections && !legacyRefs && !legacyAssets) {
      return { collections: 0, items: 0, nonEmptyPaths: 0 };
    }
    const now = new Date().toISOString();
    let expectedCollections = 0;
    let expectedItems = 0;
    let expectedNonEmptyPaths = 0;
    if (legacyCollections) {
      const columns = new Set(
        (
          snapshot.pragma("table_info(collections)") as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      );
      const hasTitle = columns.has("title");
      const hasParent = columns.has("parent_id");
      const hasSort = columns.has("sort_order");
      const hasUpdated = columns.has("updated_at");
      const titleColumn = hasTitle ? "title" : "name";
      const rows = snapshot.prepare("SELECT * FROM collections").all() as Array<
        Record<string, unknown>
      >;
      expectedCollections = rows.length;
      const insert = db.prepare(`
        INSERT INTO collections
          (id, parent_id, name, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const row of rows) {
        insert.run(
          row.id,
          hasParent ? (row.parent_id ?? null) : null,
          row[titleColumn] ?? "未命名集合",
          hasSort ? (row.sort_order ?? 0) : 0,
          row.created_at ?? now,
          hasUpdated ? (row.updated_at ?? row.created_at) : row.created_at ?? now,
        );
      }
    }
    if (legacyRefs) {
      const columns = new Set(
        (
          snapshot.pragma("table_info(collection_refs)") as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      );
      const hasMountId = columns.has("mount_id");
      const hasRelativePath = columns.has("relative_path");
      const hasFingerprint = columns.has("fingerprint");
      const hasState = columns.has("state");
      const refRows = snapshot.prepare("SELECT * FROM collection_refs").all() as Array<
        Record<string, unknown>
      >;
      expectedItems += refRows.length;
      const insert = db.prepare(`
        INSERT INTO collection_items
          (id, collection_id, identity_id, mount_id, relative_path,
           last_resolved_path, path_key, fingerprint, state, sort_order,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      for (const row of refRows) {
        const mountId = hasMountId ? (row.mount_id ?? null) : null;
        const relativePath = hasRelativePath ? (row.relative_path ?? null) : null;
        const mountRow = mountId
          ? (snapshot
              .prepare("SELECT path FROM mount_roots WHERE id = ?")
              .get(mountId) as { path: string } | undefined)
          : undefined;
        const lastResolvedPath =
          mountRow && typeof relativePath === "string" && relativePath
            ? path.join(mountRow.path, relativePath)
            : "";
        if (lastResolvedPath !== "") expectedNonEmptyPaths += 1;
        const pathKey =
          lastResolvedPath !== ""
            ? lastResolvedPath.toLocaleLowerCase("en-US")
            : String(row.id);
        insert.run(
          randomUUID(),
          row.collection_id,
          null,
          mountId,
          relativePath,
          lastResolvedPath,
          pathKey,
          hasFingerprint ? (row.fingerprint ?? null) : null,
          hasState ? (row.state ?? "resolved") : "resolved",
          row.created_at ?? now,
          row.created_at ?? now,
        );
      }
    }
    if (legacyAssets) {
      const assetRows = snapshot
        .prepare("SELECT * FROM collection_assets")
        .all() as Array<Record<string, unknown>>;
      expectedItems += assetRows.length;
      const insert = db.prepare(`
        INSERT INTO collection_items
          (id, collection_id, identity_id, mount_id, relative_path,
           last_resolved_path, path_key, fingerprint, state, sort_order,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'resolved', 0, ?, ?)
      `);
      for (const row of assetRows) {
        const asset = snapshot
          .prepare(
            "SELECT path, path_key, fingerprint FROM assets WHERE id = ?",
          )
          .get(row.asset_id) as
          | { path: string; path_key: string; fingerprint: string }
          | undefined;
        if (asset?.path) expectedNonEmptyPaths += 1;
        insert.run(
          randomUUID(),
          row.collection_id,
          null,
          null,
          null,
          asset?.path ?? "",
          asset?.path_key ?? String(row.asset_id),
          asset?.fingerprint ?? null,
          row.created_at ?? now,
          row.created_at ?? now,
        );
      }
    }
    return {
      collections: expectedCollections,
      items: expectedItems,
      nonEmptyPaths: expectedNonEmptyPaths,
    };
  } finally {
    snapshot.close();
  }
}

/** 在备份目录中寻找最新的 migrate-v15-to-v16 快照（v16 破坏前的最后备份）。 */
function findMigrationSnapshot(
  backupDirectory: string | undefined,
): string | null {
  if (!backupDirectory) return null;
  let files: string[];
  try {
    files = readdirSync(backupDirectory);
  } catch {
    return null;
  }
  const candidates = files
    .filter((file) => /^migrate-v15-to-v16-.*\.db$/i.test(file))
    .sort()
    .reverse();
  if (!candidates.length) return null;
  return path.join(backupDirectory, candidates[0]);
}

/**
 * v17 建表（静态 SQL 字面量，经 prepared statement 执行）。
 *
 * - `collections`：自引用 parent_id，删除父集合默认拒绝。
 * - `collection_items`：对 collection_id 做级联删除，不依赖 assets.id
 *   存活；同一集合同一规范化 path_key 只保留一项。
 * - `ai_jobs`：任务快照持久化；明文密钥、完整上传响应与二进制不入库。
 *
 * identity/mount 允许为空且不设外键，以便引用在索引记录退休后仍可离线保留；
 * 集合层级和条目所属关系由 SQLite 外键保证。
 */
export function createV17Tables(db: Database.Database): void {
  db.prepare(
    "CREATE TABLE IF NOT EXISTS collections (" +
      "id TEXT PRIMARY KEY, parent_id TEXT REFERENCES collections(id) " +
      "ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED, name TEXT NOT NULL, " +
      "sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, " +
      "updated_at TEXT NOT NULL)",
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS collections_parent_sort " +
      "ON collections(parent_id, sort_order, created_at)",
  ).run();
  db.prepare(
    "CREATE TABLE IF NOT EXISTS collection_items (" +
      "id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) " +
      "ON DELETE CASCADE, identity_id TEXT, " +
      "mount_id TEXT, relative_path TEXT, last_resolved_path TEXT NOT NULL, " +
      "path_key TEXT NOT NULL, fingerprint TEXT, state TEXT NOT NULL DEFAULT 'resolved' " +
      "CHECK(state IN ('resolved', 'offline', 'missing', 'ambiguous')), " +
      "sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, " +
      "updated_at TEXT NOT NULL, UNIQUE(collection_id, path_key))",
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS collection_items_collection " +
      "ON collection_items(collection_id, sort_order, id)",
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS collection_items_path_key ON collection_items(path_key)",
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS collection_items_identity ON collection_items(identity_id)",
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS collection_items_mount ON collection_items(mount_id, relative_path)",
  ).run();
  db.prepare(
    "CREATE TABLE IF NOT EXISTS ai_jobs (" +
      "id TEXT PRIMARY KEY, provider TEXT NOT NULL, external_id TEXT, " +
      "state TEXT NOT NULL, stage TEXT NOT NULL DEFAULT '', progress REAL, " +
      "request_json TEXT NOT NULL, output_directory TEXT, " +
      "outputs_json TEXT NOT NULL DEFAULT '[]', error_code TEXT, " +
      "error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS ai_jobs_created ON ai_jobs(created_at DESC, id)",
  ).run();
}

/**
 * v17：建表 + 恢复导入 + 计数校验。
 *
 * 返回 true 表示导入或空建表完成；抛错表示校验失败（调用方事务回滚，
 * user_version 不前进）。
 */
export function restoreCollectionsV17(
  db: Database.Database,
  context: CollectionMigrationContext,
): void {
  const existingCollections = db
    .prepare("SELECT COUNT(*) AS count FROM collections")
    .get() as { count: number };
  const existingItems = db
    .prepare("SELECT COUNT(*) AS count FROM collection_items")
    .get() as { count: number };

  let imported: RestoredCounts | null;
  if (existingCollections.count > 0 || existingItems.count > 0) {
    // 幂等重跑：已有数据时不再重复导入。
    imported = currentCounts(db);
  } else {
    const legacyCollections = tableExists(db, "_legacy_collections_v16");
    const legacyRefs = tableExists(db, "_legacy_collection_refs_v16");
    const legacyAssets = tableExists(db, "_legacy_collection_assets_v16");
    const legacySources = tableExists(db, "_legacy_collection_sources_v16");
    if (legacyCollections || legacyRefs || legacyAssets || legacySources) {
      imported = importFromArchive(db, legacyCollections, legacyRefs, legacyAssets);
    } else {
      const snapshotPath = findMigrationSnapshot(context.migrationBackupDirectory);
      imported = snapshotPath ? importFromSnapshot(db, snapshotPath) : null;
    }
  }

  if (imported === null) {
    // 既无归档也无快照：旧 v16 已破坏且无备份，数据已不存在。建空表 +
    // 一次性事实说明（不声称恢复了不存在的行）。
    const notice = JSON.stringify({
      notice: "collections.v16.dataLoss",
      detail:
        "当前数据库已由早于 0.38 的构建升级到 schema 16 且未保留可恢复归档或迁移备份；引用集合数据无法恢复。",
      timestamp: new Date().toISOString(),
    });
    const existing = db
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get("collections.v16.dataLossNotice") as
      | { value_json: string }
      | undefined;
    if (!existing) {
      db.prepare(
        "INSERT INTO settings (key, value_json) VALUES (?, ?)",
      ).run("collections.v16.dataLossNotice", notice);
    }
    return;
  }

  const after = currentCounts(db);
  if (
    after.collections !== imported.collections ||
    after.items !== imported.items ||
    after.nonEmptyPaths !== imported.nonEmptyPaths
  ) {
    throw new Error(
      `MIGRATION_V17_IMPORT_MISMATCH: expected ${imported.collections}/${imported.items}/${imported.nonEmptyPaths} (collections/items/nonEmptyPaths), got ${after.collections}/${after.items}/${after.nonEmptyPaths}`,
    );
  }
}
