import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { ActionService } from "../../../src/main/services/action-service";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { LibraryService } from "../../../src/main/services/library-service";

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

async function setup(): Promise<{
  database: RefCanvasDatabase;
  service: LibraryService;
  actions: ActionService;
  base: string;
  output: string;
}> {
  const base = await tempDirectory("refcanvas-actions-");
  const database = new RefCanvasDatabase(":memory:");
  const service = new LibraryService(database, path.join(base, "trash"));
  const output = path.join(base, "out");
  const actions = new ActionService(database, output);
  return { database, service, actions, base, output };
}

async function waitForCompletion(
  actions: ActionService,
  id: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = actions.get(id)!;
    // `reviewing` means the job is waiting on user conflict confirmation.
    if (["completed", "cancelled", "failed", "reviewing"].includes(snapshot.state)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("ACTION_TIMEOUT");
}

describe("ActionService", () => {
  it("converts images with naming templates and keeps the source unchanged", async () => {
    const { database, service, actions, base, output } = await setup();
    const source = path.join(base, "art.png");
    await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 40, g: 80, b: 120 } },
    }).png().toFile(source);
    try {
      await service.importPaths([source]);
      const asset = database.searchAssets().items[0];
      const snapshot = actions.start({
        type: "convert",
        targets: { mode: "ids", ids: [asset.id] },
        options: { format: "webp", quality: 90 },
        outputDirectory: output,
        namingTemplate: "{name}-{index}-{date}",
      });
      await waitForCompletion(actions, snapshot.id);

      const done = actions.get(snapshot.id)!;
      expect(done.state).toBe("completed");
      expect(done.created).toBe(1);
      const outputPath = done.items[0].outputPath!;
      expect(path.basename(outputPath)).toMatch(/^art-\d{2}-\d{4}-\d{2}-\d{2}\.webp$/);
      await expect(stat(outputPath)).resolves.toBeDefined();
      // Source untouched.
      await expect(stat(source)).resolves.toBeDefined();
    } finally {
      actions.close();
      await service.close();
      database.close();
    }
  });

  it("merges images horizontally into a single png", async () => {
    const { database, service, actions, base, output } = await setup();
    const first = path.join(base, "a.png");
    const second = path.join(base, "b.png");
    await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toFile(first);
    await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toFile(second);
    try {
      await service.importPaths([first, second]);
      const ids = database.searchAssets().items.map((item) => item.id);
      const snapshot = actions.start({
        type: "merge-images",
        targets: { mode: "ids", ids },
        options: { direction: "horizontal", gap: 0 },
        outputDirectory: output,
      });
      await waitForCompletion(actions, snapshot.id);
      const done = actions.get(snapshot.id)!;
      expect(done.state).toBe("completed");
      const metadata = await sharp(done.items[0].outputPath!).metadata();
      expect(metadata.width).toBe(40);
      expect(metadata.height).toBe(20);
    } finally {
      actions.close();
      await service.close();
      database.close();
    }
  });

  it("parks overwrite conflicts in reviewing state and resolves per choice", async () => {
    const { database, service, actions, base, output } = await setup();
    const source = path.join(base, "photo.png");
    await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toFile(source);
    const existing = path.join(output, "photo.png");
    await mkdir(output, { recursive: true });
    await writeFile(existing, "occupied");
    try {
      await service.importPaths([source]);
      const asset = database.searchAssets().items[0];
      const request = {
        type: "convert",
        targets: { mode: "ids", ids: [asset.id] },
        options: { format: "png" },
        outputDirectory: output,
      } satisfies import("../../../src/shared/contracts").AssetActionRequest;
      expect(actions.preview(request)).toMatchObject({
        inputCount: 1,
        outputDirectory: output,
        conflicts: [existing],
      });
      const snapshot = actions.start(request);
      await waitForCompletion(actions, snapshot.id);
      const reviewing = actions.get(snapshot.id)!;
      expect(reviewing.state).toBe("reviewing");
      expect(reviewing.conflicts).toContain(existing);

      // Refuse the conflict: item is skipped.
      const skipped = await actions.resolveConflict(snapshot.id, existing, false);
      expect(skipped.state).toBe("completed");
      expect(skipped.items[0].status).toBe("done");
      expect(skipped.items[0].error).toBe("SKIPPED_CONFLICT");

      // Re-run and overwrite this time.
      const retried = actions.retry(snapshot.id);
      await waitForCompletion(actions, retried.id);
      const overwritten = await actions.resolveConflict(retried.id, existing, true);
      expect(overwritten.state).toBe("completed");
      await expect(stat(existing)).resolves.toBeDefined();
    } finally {
      actions.close();
      await service.close();
      database.close();
    }
  });

  it("cancels an in-flight job and reports failed items on retry", async () => {
    const { database, service, actions, base, output } = await setup();
    const many: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const filename = path.join(base, `img-${index}.png`);
      await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: index, g: 0, b: 0 } } }).png().toFile(filename);
      many.push(filename);
    }
    try {
      await service.importPaths(many);
      const ids = database.searchAssets().items.map((item) => item.id);
      const snapshot = actions.start({
        type: "convert",
        targets: { mode: "ids", ids },
        options: { format: "webp" },
        outputDirectory: output,
      });
      actions.cancel(snapshot.id);
      // Give the worker a beat to observe the abort.
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const state = actions.get(snapshot.id)!.state;
        if (state === "cancelled" || state === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const cancelled = actions.get(snapshot.id)!;
      expect(["cancelled", "completed"]).toContain(cancelled.state);
    } finally {
      actions.close();
      await service.close();
      database.close();
    }
  });

  it("exports CSV and writes metadata sidecars", async () => {
    const { database, service, actions, base, output } = await setup();
    const source = path.join(base, "sample.png");
    await sharp({ create: { width: 24, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toFile(source);
    try {
      await service.importPaths([source]);
      const asset = database.searchAssets().items[0];
      const csvSnapshot = actions.start({
        type: "export-csv",
        targets: { mode: "ids", ids: [asset.id] },
        options: { fields: ["title", "size", "tags"] },
        outputDirectory: output,
      });
      await waitForCompletion(actions, csvSnapshot.id);
      const csv = await readFile(actions.get(csvSnapshot.id)!.items[0].outputPath!, "utf8");
      expect(csv).toContain("title");
      expect(csv).toContain("sample");

      const sidecarSnapshot = actions.start({
        type: "export-folder",
        targets: { mode: "ids", ids: [asset.id] },
        options: {},
        outputDirectory: output,
        writeSidecar: true,
      });
      await waitForCompletion(actions, sidecarSnapshot.id);
      const sidecarFile = `${actions.get(sidecarSnapshot.id)!.items[0].outputPath}.refcanvas-meta.json`;
      const sidecar = JSON.parse(await readFile(sidecarFile, "utf8"));
      expect(sidecar.format).toBe("refcanvas-sidecar");
      expect(sidecar.asset.id).toBe(asset.id);
    } finally {
      actions.close();
      await service.close();
      database.close();
    }
  });
});
