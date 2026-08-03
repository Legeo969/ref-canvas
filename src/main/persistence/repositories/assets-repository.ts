import type Database from "better-sqlite3";
import path from "node:path";
import type {
  AssetPage,
  AssetRecord,
  AssetSearchInput,
  AssetSearchWindow,
  AssetSearchWindowInput,
  SelectionScope,
} from "../../../shared/contracts";

export interface AssetPersistenceRow {
  id: string;
  title: string;
  kind: AssetRecord["kind"];
  path: string;
  path_key: string;
  extension: string;
  size: number;
  mtime_ms: number;
  fingerprint: string;
  content_hash: string | null;
  visual_hash: string | null;
  color_signature: string | null;
  dominant_r: number | null;
  dominant_g: number | null;
  dominant_b: number | null;
  lifecycle: AssetRecord["lifecycle"];
  deleted_at: string | null;
  trash_path: string | null;
  favorite: number;
  rating: number;
  color_label: AssetRecord["colorLabel"];
  link_state: AssetRecord["linkState"];
  notes: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  bpm: number | null;
  metadata_status: AssetRecord["metadataStatus"];
  metadata_error: string | null;
  metadata_updated_at: string | null;
  metadata_job_id: string | null;
  custom_fields: string | null;
  custom_thumbnail_path: string | null;
  storage_mode: AssetRecord["storageMode"];
  library_relative_path: string | null;
  original_source_path: string | null;
  created_at: string;
  updated_at: string;
}

const sortColumns = {
  createdAt: "a.created_at",
  updatedAt: "a.updated_at",
  mtimeMs: "a.mtime_ms",
  title: "a.title COLLATE NOCASE",
  size: "a.size",
  rating: "a.rating",
  random: "RANDOM()",
} as const;

function parseCustomFields(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    return {};
  }
  return {};
}

export function mapAssetRow(row: AssetPersistenceRow): AssetRecord {
  const modelUrl = row.kind === "model3d"
    ? `refasset://asset/${row.id}/${encodeURIComponent(path.basename(row.path))}`
    : `refasset://asset/${row.id}`;
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    path: row.path,
    extension: row.extension,
    size: row.size,
    mtimeMs: row.mtime_ms,
    fingerprint: row.fingerprint,
    contentHash: row.content_hash,
    lifecycle: row.lifecycle,
    deletedAt: row.deleted_at,
    trashPath: row.trash_path,
    favorite: Boolean(row.favorite),
    rating: row.rating,
    colorLabel: row.color_label,
    linkState: row.link_state,
    notes: row.notes,
    width: row.width,
    height: row.height,
    duration: row.duration,
    metadataStatus: row.metadata_status ?? "ready",
    metadataError: row.metadata_error ?? null,
    metadataUpdatedAt: row.metadata_updated_at ?? null,
    bpm: row.bpm,
    customFields: parseCustomFields(row.custom_fields),
    customThumbnailPath: row.custom_thumbnail_path,
    tags: [],
    collectionIds: [],
    storageMode: row.storage_mode ?? "linked",
    libraryRelativePath: row.library_relative_path,
    originalSourcePath: row.original_source_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    previewUrl: modelUrl,
    thumbnailUrl: `refasset://thumbnail/${row.id}`,
  };
}

export interface AssetSourceRecord {
  id: string;
  kind: AssetRecord["kind"];
  lifecycle: AssetRecord["lifecycle"];
  customThumbnailPath: string | null;
  mtimeMs: number;
  size: number;
  fingerprint: string;
  sourcePath: string | null;
}

export class AssetsRepository {
  constructor(private readonly db: Database.Database) {}

  hydrateRelations(assets: AssetRecord[]): AssetRecord[] {
    if (!assets.length) return assets;
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const ids = [...byId.keys()];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      const placeholders = batch.map(() => "?").join(",");
      const tags = this.db.prepare(`
        SELECT at.asset_id, t.name
        FROM asset_tags at JOIN tags t ON t.id = at.tag_id
        WHERE at.asset_id IN (${placeholders})
        ORDER BY at.asset_id, t.name COLLATE NOCASE
      `).all(...batch) as Array<{ asset_id: string; name: string }>;
      const collections = this.db.prepare(`
        SELECT asset_id, collection_id
        FROM collection_assets
        WHERE asset_id IN (${placeholders})
        ORDER BY asset_id, collection_id
      `).all(...batch) as Array<{ asset_id: string; collection_id: string }>;
      for (const tag of tags) byId.get(tag.asset_id)?.tags.push(tag.name);
      for (const collection of collections) {
        byId.get(collection.asset_id)?.collectionIds.push(collection.collection_id);
      }
    }
    return assets;
  }

  getSource(id: string): AssetSourceRecord | null {
    const row = this.db.prepare(`
      SELECT id, kind, lifecycle, custom_thumbnail_path, mtime_ms, size,
             fingerprint, path, trash_path
      FROM assets WHERE id = ?
    `).get(id) as {
      id: string;
      kind: AssetRecord["kind"];
      lifecycle: AssetRecord["lifecycle"];
      custom_thumbnail_path: string | null;
      mtime_ms: number;
      size: number;
      fingerprint: string;
      path: string;
      trash_path: string | null;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      lifecycle: row.lifecycle,
      customThumbnailPath: row.custom_thumbnail_path,
      mtimeMs: row.mtime_ms,
      size: row.size,
      fingerprint: row.fingerprint,
      sourcePath:
        row.lifecycle === "purged"
          ? null
          : row.lifecycle === "trashed"
            ? row.trash_path
            : row.path,
    };
  }
  private buildSearch(input: AssetSearchInput, includeCursor: boolean): {
    joins: string;
    where: string;
    params: unknown[];
    order: string;
    pageSize: number;
  } {
    const clauses: string[] = ["a.lifecycle = ?"];
    const params: unknown[] = [input.lifecycle ?? "active"];
    const joins: string[] = [];
    const query = input.query?.trim() ?? "";
    if (input.kind && input.kind !== "all") {
      clauses.push("a.kind = ?");
      params.push(input.kind);
    }
    if (input.linkState && input.linkState !== "all") {
      clauses.push("a.link_state = ?");
      params.push(input.linkState);
    }
    if (input.extension) {
      clauses.push("a.extension = ? COLLATE NOCASE");
      params.push(input.extension.replace(/^\./, ""));
    }
    if (input.orientation) {
      clauses.push("a.width > 0 AND a.height > 0");
      if (input.orientation === "landscape") clauses.push("a.width > a.height");
      if (input.orientation === "portrait") clauses.push("a.height > a.width");
      if (input.orientation === "square") {
        clauses.push("ABS(a.width - a.height) <= MAX(a.width, a.height) * 0.02");
      }
    }
    if (query) {
      const rawTokens = query.split(/\s+/).filter(Boolean);
      const tokens = rawTokens
        .map((token) => `"${token.replaceAll('"', '""')}"*`);
      const ftsQuery = tokens.join(" AND ");
      const annotationFallback = rawTokens
        .map(
          () => `EXISTS (
            SELECT 1 FROM asset_annotations aal
            WHERE aal.asset_id = a.id
              AND LOWER(aal.text) LIKE LOWER(?) ESCAPE '\\'
          )`,
        )
        .join(" AND ");
      clauses.push(`(
        a.rowid IN (
          SELECT rowid FROM assets_fts WHERE assets_fts MATCH ?
        )
        OR a.id IN (
          SELECT aa.asset_id
          FROM asset_annotations aa
          JOIN asset_annotations_fts aaf ON aaf.rowid = aa.rowid
          WHERE asset_annotations_fts MATCH ?
        )
        OR (${annotationFallback})
      )`);
      params.push(
        ftsQuery,
        ftsQuery,
        ...rawTokens.map(
          (token) => `%${token.replace(/[\\%_]/g, "\\$&")}%`,
        ),
      );
    }
    if (input.collectionId) {
      joins.push("JOIN collection_assets ca ON ca.asset_id = a.id");
      if (!input.linkState || input.linkState === "all") {
        clauses.push("a.link_state = 'online'");
      }
      if (input.includeSubcollections === false) {
        clauses.push("ca.collection_id = ?");
        params.push(input.collectionId);
      } else {
        clauses.push(`ca.collection_id IN (
        WITH RECURSIVE descendants(id) AS (
          SELECT ?
          UNION ALL
          SELECT c.id FROM collections c
          JOIN descendants d ON c.parent_id = d.id
        )
        SELECT id FROM descendants
      )`);
        params.push(input.collectionId);
      }
    }
    if (input.tag) {
      joins.push("JOIN asset_tags sat ON sat.asset_id = a.id");
      joins.push("JOIN tags st ON st.id = sat.tag_id");
      clauses.push("(st.name = ? COLLATE NOCASE OR st.alias = ? COLLATE NOCASE)");
      params.push(input.tag, input.tag);
    }
    if (input.includeTags?.length) {
      input.includeTags.forEach((tag, tagIndex) => {
        const alias = `it${tagIndex}`;
        joins.push(
          `JOIN asset_tags ${alias} ON ${alias}.asset_id = a.id`,
        );
        joins.push(
          `JOIN tags itg${tagIndex} ON itg${tagIndex}.id = ${alias}.tag_id`,
        );
        clauses.push(
          `(itg${tagIndex}.name = ? COLLATE NOCASE OR itg${tagIndex}.alias = ? COLLATE NOCASE)`,
        );
        params.push(tag, tag);
      });
    }
    if (input.anyTags?.length) {
      joins.push("JOIN asset_tags at_any ON at_any.asset_id = a.id");
      joins.push("JOIN tags atg_any ON atg_any.id = at_any.tag_id");
      clauses.push(
        `(atg_any.name IN (${input.anyTags.map(() => "?").join(",")}) COLLATE NOCASE OR atg_any.alias IN (${input.anyTags.map(() => "?").join(",")}) COLLATE NOCASE)`,
      );
      params.push(...input.anyTags, ...input.anyTags);
    }
    if (input.excludeTags?.length) {
      for (const tag of input.excludeTags) {
        clauses.push(`NOT EXISTS (
          SELECT 1 FROM asset_tags xt JOIN tags xg ON xg.id = xt.tag_id
          WHERE xt.asset_id = a.id
            AND (xg.name = ? COLLATE NOCASE OR xg.alias = ? COLLATE NOCASE)
        )`);
        params.push(tag, tag);
      }
    }
    if (input.pathContains) {
      clauses.push("LOWER(a.path) LIKE LOWER(?) ESCAPE '\\'");
      params.push(`%${input.pathContains.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (input.filenameContains) {
      clauses.push("LOWER(a.title) LIKE LOWER(?) ESCAPE '\\'");
      params.push(`%${input.filenameContains.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (input.notesContains) {
      clauses.push("(LOWER(a.notes) LIKE LOWER(?) ESCAPE '\\' OR EXISTS (SELECT 1 FROM asset_annotations an WHERE an.asset_id = a.id AND LOWER(an.text) LIKE LOWER(?) ESCAPE '\\') OR EXISTS (SELECT 1 FROM media_notes mn WHERE mn.asset_id = a.id AND LOWER(mn.text) LIKE LOWER(?) ESCAPE '\\'))");
      params.push(
        `%${input.notesContains.replace(/[\\%_]/g, "\\$&")}%`,
        `%${input.notesContains.replace(/[\\%_]/g, "\\$&")}%`,
        `%${input.notesContains.replace(/[\\%_]/g, "\\$&")}%`,
      );
    }
    if (input.exactAspectRatio) {
      const match = /^(\d+)\s*[:：]\s*(\d+)$/.exec(input.exactAspectRatio);
      if (match) {
        const widthRatio = Number(match[1]);
        const heightRatio = Number(match[2]);
        clauses.push(
          "a.width > 0 AND a.height > 0 AND ABS(a.width * ? - a.height * ?) <= MAX(a.width, a.height)",
        );
        params.push(heightRatio, widthRatio);
      }
    }
    if (input.customFields?.length) {
      for (const condition of input.customFields) {
        clauses.push(`EXISTS (
          SELECT 1 FROM json_each(a.custom_fields) je
          WHERE je.key = ? AND LOWER(je.value) LIKE LOWER(?) ESCAPE '\\'
        )`);
        params.push(
          condition.key,
          `%${condition.value.replace(/[\\%_]/g, "\\$&")}%`,
        );
      }
    }
    if (input.favorite !== undefined) {
      clauses.push("a.favorite = ?");
      params.push(input.favorite ? 1 : 0);
    }
    if (input.ratingMin !== undefined) {
      clauses.push("a.rating >= ?");
      params.push(input.ratingMin);
    }
    if (input.colorLabel && input.colorLabel !== "none") {
      clauses.push("a.color_label = ?");
      params.push(input.colorLabel);
    }
    if (input.dominantColor) {
      const match = /^#([0-9a-f]{6})$/i.exec(input.dominantColor);
      if (!match) throw new Error("INVALID_DOMINANT_COLOR");
      const color = Number.parseInt(match[1], 16);
      const red = (color >> 16) & 255;
      const green = (color >> 8) & 255;
      const blue = color & 255;
      const tolerance = Math.min(Math.max(input.colorTolerance ?? 25, 1), 100);
      const maxDistanceSquared = (441.673 * tolerance / 100) ** 2;
      clauses.push(`
        a.dominant_r IS NOT NULL
        AND (
          (a.dominant_r - ?) * (a.dominant_r - ?)
          + (a.dominant_g - ?) * (a.dominant_g - ?)
          + (a.dominant_b - ?) * (a.dominant_b - ?)
        ) <= ?
      `);
      params.push(
        red,
        red,
        green,
        green,
        blue,
        blue,
        maxDistanceSquared,
      );
    }
    for (const [key, column, operator] of [
      ["minWidth", "a.width", ">="],
      ["maxWidth", "a.width", "<="],
      ["minHeight", "a.height", ">="],
      ["maxHeight", "a.height", "<="],
      ["minSize", "a.size", ">="],
      ["maxSize", "a.size", "<="],
      ["minDuration", "a.duration", ">="],
      ["maxDuration", "a.duration", "<="],
      ["minBpm", "a.bpm", ">="],
      ["maxBpm", "a.bpm", "<="],
      ["createdAfter", "a.created_at", ">="],
      ["createdBefore", "a.created_at", "<="],
    ] as const) {
      const value = input[key];
      if (value !== undefined) {
        clauses.push(`${column} ${operator} ?`);
        params.push(value);
      }
    }
    for (const [key, operator] of [
      ["modifiedAfter", ">="],
      ["modifiedBefore", "<="],
    ] as const) {
      const value = input[key];
      if (value !== undefined) {
        clauses.push(`a.mtime_ms ${operator} ?`);
        params.push(Date.parse(value));
      }
    }

    const sort = input.sort ?? "createdAt";
    const direction = input.direction ?? "desc";
    const column = sortColumns[sort];
    // Random order is inherently unstable, so cursor pagination is disabled for it.
    if (includeCursor && input.cursor && sort !== "random") {
      try {
        const cursor = JSON.parse(
          Buffer.from(input.cursor, "base64url").toString("utf8"),
        ) as { value: string | number; id: string };
        const operator = direction === "desc" ? "<" : ">";
        clauses.push(`(${column} ${operator} ? OR (${column} = ? AND a.id ${operator} ?))`);
        params.push(cursor.value, cursor.value, cursor.id);
      } catch {
        throw new Error("INVALID_CURSOR");
      }
    }
    return {
      joins: joins.join("\n"),
      where: `WHERE ${clauses.join(" AND ")}`,
      params,
      order: `${column} ${direction.toUpperCase()}, a.id ${direction.toUpperCase()}`,
      pageSize: Math.min(Math.max(input.pageSize ?? input.limit ?? 120, 1), 500),
    };
  }

  searchAssets(input: AssetSearchInput = {}): AssetPage {
    const query = this.buildSearch(input, true);
    const countQuery = this.buildSearch({ ...input, cursor: undefined }, false);
    const total = (this.db.prepare(`
      SELECT COUNT(DISTINCT a.id) AS count FROM assets a
      ${countQuery.joins} ${countQuery.where}
    `).get(...countQuery.params) as { count: number }).count;
    const offset = Math.max(input.offset ?? 0, 0);
    const rows = this.db.prepare(`
      SELECT DISTINCT a.* FROM assets a ${query.joins} ${query.where}
      ORDER BY ${query.order} LIMIT ? OFFSET ?
    `).all(...query.params, query.pageSize + 1, offset) as AssetPersistenceRow[];
    const hasMore = rows.length > query.pageSize;
    const items = this.hydrateRelations(
      rows.slice(0, query.pageSize).map(mapAssetRow),
    );
    const last = rows[Math.min(query.pageSize, rows.length) - 1];
    const sort = input.sort ?? "createdAt";
    const cursorValues: Record<
      Exclude<typeof sort, "random">,
      string | number
    > = {
      createdAt: last?.created_at,
      updatedAt: last?.updated_at,
      mtimeMs: last?.mtime_ms,
      title: last?.title,
      size: last?.size,
      rating: last?.rating,
    };
    const nextCursor =
      hasMore && last && sort !== "random"
        ? Buffer.from(
            JSON.stringify({
              value: cursorValues[sort as Exclude<typeof sort, "random">],
              id: last.id,
            }),
          ).toString("base64url")
        : null;
    return { items, total, nextCursor };
  }

  searchAssetWindow(input: AssetSearchWindowInput): AssetSearchWindow {
    const search = {
      ...input.query,
      cursor: undefined,
      offset: undefined,
      pageSize: input.pageSize,
    };
    const query = this.buildSearch(search, false);
    const total = input.includeTotal
      ? (this.db.prepare(`
          SELECT COUNT(DISTINCT a.id) AS count FROM assets a
          ${query.joins} ${query.where}
        `).get(...query.params) as { count: number }).count
      : null;
    const rows = this.db.prepare(`
      SELECT DISTINCT a.* FROM assets a ${query.joins} ${query.where}
      ORDER BY ${query.order} LIMIT ? OFFSET ?
    `).all(
      ...query.params,
      query.pageSize,
      Math.max(input.offset, 0),
    ) as AssetPersistenceRow[];
    return { items: this.hydrateRelations(rows.map(mapAssetRow)), total };
  }

  resolveSelection(scope: SelectionScope): string[] {
    if (scope.mode === "ids") return [...new Set(scope.ids)];
    const query = this.buildSearch({ ...scope.query, cursor: undefined }, false);
    const excluded = new Set(scope.excludedIds);
    const rows = this.db.prepare(`
      SELECT DISTINCT a.id FROM assets a ${query.joins} ${query.where}
    `).all(...query.params) as Array<{ id: string }>;
    return rows.map((row) => row.id).filter((id) => !excluded.has(id));
  }

}
