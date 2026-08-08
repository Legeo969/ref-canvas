import Database from "better-sqlite3";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BackupRecord } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";

const backupPattern = /^refcanvas-(auto|manual)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.backup$/;

function backupName(): string {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `refcanvas-manual-${stamp}.backup`;
}

export class BackupService {
  constructor(
    private readonly database: RefCanvasDatabase,
    private readonly backupDirectory: string,
  ) {}

  async list(): Promise<BackupRecord[]> {
    await mkdir(this.backupDirectory, { recursive: true });
    const records: BackupRecord[] = [];
    for (const filename of await readdir(this.backupDirectory)) {
      const match = backupPattern.exec(filename);
      if (!match) continue;
      const fullPath = path.join(this.backupDirectory, filename);
      const fileStat = await stat(fullPath);
      records.push({
        filename,
        path: fullPath,
        size: fileStat.size,
        createdAt: fileStat.birthtime.toISOString(),
        automatic: match[1] === "auto",
      });
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(): Promise<BackupRecord> {
    await mkdir(this.backupDirectory, { recursive: true });
    const filename = backupName();
    const fullPath = path.join(this.backupDirectory, filename);
    await this.database.backupTo(fullPath);
    const fileStat = await stat(fullPath);
    const record = {
      filename,
      path: fullPath,
      size: fileStat.size,
      createdAt: fileStat.birthtime.toISOString(),
      automatic: false,
    };
    return record;
  }

  validate(filename: string): void {
    const candidate = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      const integrity = candidate.pragma("integrity_check", { simple: true });
      const version = candidate.pragma("user_version", { simple: true }) as number;
      if (integrity !== "ok") throw new Error("BACKUP_INTEGRITY_CHECK_FAILED");
      if (version > this.database.getSchemaVersion()) {
        throw new Error("BACKUP_SCHEMA_TOO_NEW");
      }
    } finally {
      candidate.close();
    }
  }

  /** No owned resources; present for lifecycle symmetry with LibraryService. */
  close(): void {
    // Nothing to release — the database connection is owned by the caller.
  }
}
