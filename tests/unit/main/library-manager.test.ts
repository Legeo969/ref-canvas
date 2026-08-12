import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { DATABASE_SCHEMA_VERSION } from "../../../src/main/persistence/repositories/migration-repository";
import {
  LibraryManager,
  databasePathFor,
} from "../../../src/main/services/library-manager";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("LibraryManager (single active library)", () => {
  it("bootstraps the legacy data directory as the single active library", async () => {
    const userData = await tempDirectory("refcanvas-registry-");
    const manager = new LibraryManager(userData);
    const entry = await manager.bootstrapLegacy();

    expect(entry.legacy).toBe(true);
    expect(entry.root).toBe(userData);
    expect(manager.currentEntry()?.id).toBe(entry.id);
    expect(manager.currentEntry()?.name).toBe("本地索引");
  });

  it("is idempotent across repeated bootstrap calls", async () => {
    const userData = await tempDirectory("refcanvas-registry-restart-");
    const manager = new LibraryManager(userData);
    const first = await manager.bootstrapLegacy();
    const second = await manager.bootstrapLegacy();

    expect(second.id).toBe(first.id);
    expect(second.root).toBe(userData);
  });

  it("resolves a usable database path inside the data directory", async () => {
    const userData = await tempDirectory("refcanvas-dbpath-");
    const manager = new LibraryManager(userData);
    const entry = await manager.bootstrapLegacy();

    const db = new RefCanvasDatabase(databasePathFor(entry));
    try {
      expect(db.getSchemaVersion()).toBe(DATABASE_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});
