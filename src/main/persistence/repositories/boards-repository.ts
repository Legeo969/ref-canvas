import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  BoardAppearance,
  BoardDocument,
  BoardDocumentV2,
  BoardDocumentV3,
  BoardSummary,
} from "../../../shared/contracts";

export interface BoardPersistenceRow {
  id: string;
  title: string;
  document_json: string;
  created_at: string;
  updated_at: string;
}

const defaultBoardAppearance: BoardAppearance = {
  backgroundColor: "#202426",
  gridVisible: true,
  gridSize: 24,
};

function normalizeBoardAppearance(
  appearance?: Partial<BoardAppearance>,
): BoardAppearance {
  const backgroundColor =
    typeof appearance?.backgroundColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(appearance.backgroundColor)
      ? appearance.backgroundColor
      : defaultBoardAppearance.backgroundColor;
  const gridSize =
    typeof appearance?.gridSize === "number" &&
    Number.isFinite(appearance.gridSize)
      ? Math.min(96, Math.max(8, Math.round(appearance.gridSize)))
      : defaultBoardAppearance.gridSize;
  return {
    backgroundColor,
    gridVisible:
      typeof appearance?.gridVisible === "boolean"
        ? appearance.gridVisible
        : defaultBoardAppearance.gridVisible,
    gridSize,
  };
}

export function toBoardV2(document: BoardDocument): BoardDocumentV2 {
  if (document.schemaVersion === 2) {
    return {
      ...document,
      appearance: normalizeBoardAppearance(document.appearance),
    };
  }
  return {
    schemaVersion: 2,
    canvas: document.canvas,
    viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
    guides: { x: [], y: [] },
    appearance: { ...defaultBoardAppearance },
  };
}

export function toBoardV3(document: BoardDocument): BoardDocumentV3 {
  const source = document.schemaVersion === 3 ? document as BoardDocumentV3 : null;
  const legacy = document.schemaVersion !== 3 ? toBoardV2(document) : null;
  const canvasMode = source?.canvasMode ?? {
    locked: false,
    grayscale: false,
    gridStyle: "line" as const,
  };
  return {
    schemaVersion: 3,
    canvas: legacy?.canvas ?? document.canvas,
    viewport: source?.viewport ?? legacy?.viewport ?? toBoardV2(document).viewport,
    guides: source?.guides ?? legacy?.guides ?? toBoardV2(document).guides,
    appearance: legacy?.appearance ?? normalizeBoardAppearance(source!.appearance),
    windowMode: source?.windowMode ?? "normal",
    canvasMode: {
      locked: Boolean(canvasMode.locked),
      grayscale: Boolean(canvasMode.grayscale),
      gridStyle:
        canvasMode.gridStyle === "dot" || canvasMode.gridStyle === "none"
          ? canvasMode.gridStyle
          : "line",
    },
    sampling: source?.sampling === "nearest" ? "nearest" : "bilinear",
    exportSettings: {
      format:
        source?.exportSettings?.format === "jpeg" ||
        source?.exportSettings?.format === "webp"
          ? source.exportSettings.format
          : "png",
      embedAssets: Boolean(source?.exportSettings?.embedAssets),
    },
  };
}

function visitDocument(
  value: unknown,
  visitor: (record: Record<string, unknown>) => void,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visitDocument(item, visitor);
    return;
  }
  const record = value as Record<string, unknown>;
  visitor(record);
  for (const child of Object.values(record)) visitDocument(child, visitor);
}

export function boardAssetIds(document: BoardDocument): string[] {
  const ids = new Set<string>();
  visitDocument(document.canvas, (record) => {
    const data = record.data;
    if (data && typeof data === "object") {
      const id = (data as Record<string, unknown>).assetId;
      if (typeof id === "string") ids.add(id);
    }
  });
  return [...ids];
}

export function rewriteBoardAssetId(
  document: BoardDocumentV2,
  oldId: string,
  newId: string,
): BoardDocumentV2 {
  visitDocument(document.canvas, (record) => {
    const data = record.data;
    if (data && typeof data === "object") {
      const payload = data as Record<string, unknown>;
      if (payload.assetId === oldId) payload.assetId = newId;
    }
    if (typeof record.src === "string") {
      record.src = record.src.replace(
        new RegExp(`refasset://(asset|thumbnail)/${oldId}(?=/|$)`),
        `refasset://$1/${newId}`,
      );
    }
  });
  return document;
}

function mapBoard(row: BoardPersistenceRow): BoardSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class BoardsRepository {
  constructor(private readonly db: Database.Database) {}

  listRows(): BoardPersistenceRow[] {
    return this.db.prepare(
      "SELECT * FROM boards ORDER BY updated_at DESC",
    ).all() as BoardPersistenceRow[];
  }

  list(): BoardSummary[] {
    const rows = this.listRows();
    return rows.length ? rows.map(mapBoard) : [this.create("参考板 01")];
  }

  create(title = "未命名白板"): BoardSummary {
    const id = randomUUID();
    const now = new Date().toISOString();
    const document: BoardDocumentV3 = {
      schemaVersion: 3,
      canvas: { version: "7.4.0", objects: [] },
      viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
      guides: { x: [], y: [] },
      appearance: { ...defaultBoardAppearance },
      windowMode: "normal",
      canvasMode: { locked: false, grayscale: false, gridStyle: "line" },
      sampling: "bilinear",
      exportSettings: { format: "png", embedAssets: false },
    };
    this.db.prepare(`
      INSERT INTO boards (id, title, document_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, title, JSON.stringify(document), now, now);
    return { id, title, createdAt: now, updatedAt: now };
  }

  rename(id: string, title: string): BoardSummary {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE boards SET title = ?, updated_at = ? WHERE id = ?",
    ).run(title, now, id);
    if (!result.changes) throw new Error("BOARD_NOT_FOUND");
    return mapBoard(this.row(id)!);
  }

  delete(id: string): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) AS value FROM boards").get() as {
        value: number;
      }
    ).value;
    if (count <= 1) throw new Error("LAST_BOARD_REQUIRED");
    const result = this.db.prepare("DELETE FROM boards WHERE id = ?").run(id);
    if (!result.changes) throw new Error("BOARD_NOT_FOUND");
  }

  load(id: string): { summary: BoardSummary; document: BoardDocumentV3 } | null {
    const row = this.row(id);
    return row
      ? {
          summary: mapBoard(row),
          document: toBoardV3(JSON.parse(row.document_json) as BoardDocument),
        }
      : null;
  }

  row(id: string): BoardPersistenceRow | null {
    return (this.db.prepare("SELECT * FROM boards WHERE id = ?").get(id) as
      | BoardPersistenceRow
      | undefined) ?? null;
  }

  updateDocument(id: string, document: BoardDocumentV3, updatedAt: string): void {
    this.db.prepare(
      "UPDATE boards SET document_json = ?, updated_at = ? WHERE id = ?",
    ).run(JSON.stringify(document), updatedAt, id);
  }

  replaceAssetIds(boardId: string, assetIds: string[]): void {
    this.db.prepare("DELETE FROM board_assets WHERE board_id = ?").run(boardId);
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO board_assets (board_id, asset_id) VALUES (?, ?)",
    );
    for (const assetId of assetIds) insert.run(boardId, assetId);
  }

  clearAssetIndex(): void {
    this.db.prepare("DELETE FROM board_assets").run();
  }

  listByIds(ids: string[]): BoardSummary[] {
    if (!ids.length) return [];
    const rows = this.db.prepare(
      `SELECT * FROM boards WHERE id IN (${ids.map(() => "?").join(",")})`,
    ).all(...ids) as BoardPersistenceRow[];
    const byId = new Map(rows.map((row) => [row.id, mapBoard(row)]));
    return ids
      .map((id) => byId.get(id))
      .filter((board): board is BoardSummary => Boolean(board));
  }

  references(assetId: string): Array<{ boardId: string; boardTitle: string }> {
    const rows = this.db.prepare(`
      SELECT b.id, b.title FROM boards b
      JOIN board_assets ba ON ba.board_id = b.id
      WHERE ba.asset_id = ? ORDER BY b.updated_at DESC
    `).all(assetId) as Array<{ id: string; title: string }>;
    return rows.map((row) => ({ boardId: row.id, boardTitle: row.title }));
  }

  assetIds(boardId: string): string[] {
    const rows = this.db.prepare(
      "SELECT asset_id FROM board_assets WHERE board_id = ? ORDER BY asset_id",
    ).all(boardId) as Array<{ asset_id: string }>;
    return rows.map((row) => row.asset_id);
  }
}
