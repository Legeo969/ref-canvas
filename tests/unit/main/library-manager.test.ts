import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
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

async function makeManager(): Promise<LibraryManager> {
  const userData = await tempDirectory("refcanvas-registry-");
  const manager = new LibraryManager(userData);
  await manager.initialize();
  await manager.bootstrapLegacy();
  return manager;
}

describe("LibraryManager", () => {
  it("bootstraps the legacy data directory as the linked default library", async () => {
    const manager = await makeManager();
    const current = manager.current()!;
    expect(current.legacy).toBe(true);
    expect(current.isActive).toBe(true);
  });

  it("keeps the legacy library active after the registry is loaded again", async () => {
    const userData = await tempDirectory("refcanvas-registry-restart-");
    const first = new LibraryManager(userData);
    await first.initialize();
    const initial = await first.bootstrapLegacy();

    const restarted = new LibraryManager(userData);
    await restarted.initialize();
    const reopened = await restarted.bootstrapLegacy();

    expect(reopened.id).toBe(initial.id);
    expect(restarted.current()?.id).toBe(initial.id);
    expect(restarted.list()).toHaveLength(1);
  });

  it("creates a self-contained linked-default library with a manifest and database", async () => {
    const manager = await makeManager();
    const target = await tempDirectory("refcanvas-create-");
    const directory = path.join(target, "My Library");
    const entry = await manager.create({ name: "My Library", directory });

    expect(entry.legacy).toBe(false);
    const manifest = JSON.parse(
      await readFile(path.join(entry.root, "refcanvas.library.json"), "utf8"),
    );
    expect(manifest.format).toBe("refcanvas-library");
    expect(manifest.name).toBe("My Library");

    const db = new RefCanvasDatabase(databasePathFor(entry));
    try {
      expect(db.getSchemaVersion()).toBe(14);
      expect(db.listBoards()).toHaveLength(1);
    } finally {
      db.close();
    }
    // Opening the directory again reuses the same id instead of duplicating.
    const reopened = await manager.open(entry.root);
    expect(reopened.id).toBe(entry.id);
    expect(manager.list()).toHaveLength(2);
  });

  it("moves a library directory and verifies the registry follows", async () => {
    const manager = await makeManager();
    const base = await tempDirectory("refcanvas-move-");
    const created = await manager.create({
      name: "Movable",
      directory: path.join(base, "source"),
    });
    const movedTo = path.join(base, "moved");
    const moved = await manager.move(created.id, movedTo);

    expect(moved.root).toBe(movedTo);
    expect(manager.getEntry(created.id).root).toBe(movedTo);
    // The manifest and database travelled with the directory.
    await expect(
      readFile(path.join(movedTo, "refcanvas.library.json")),
    ).resolves.toBeDefined();
    await expect(readFile(databasePathFor(moved))).resolves.toBeDefined();
  });

  it("reports databaseBytes as a numeric file size", async () => {
    const manager = await makeManager();
    const base = await tempDirectory("refcanvas-size-");
    const entry = await manager.create({
      name: "Sized",
      directory: path.join(base, "lib"),
    });

    const summary = await manager.describe(entry.id);
    expect(typeof summary.databaseBytes).toBe("number");
    expect(summary.databaseBytes).toBeGreaterThan(0);
  });

  it("refuses to move a library inside itself", async () => {
    const manager = await makeManager();
    const base = await tempDirectory("refcanvas-cycle-");
    const entry = await manager.create({
      name: "Cyclic",
      directory: path.join(base, "lib"),
    });
    await expect(
      manager.move(entry.id, path.join(entry.root, "nested")),
    ).rejects.toThrow("LIBRARY_MOVE_INVALID");
  });
});
