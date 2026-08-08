import { afterEach, describe, expect, it } from "vitest";
import type { NewAsset } from "../../../src/main/persistence/database";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import type {
  EnumeratedImportPath,
  ImportEnumerator,
} from "../../../src/main/services/import-enumerator";
import { LibraryService } from "../../../src/main/services/library-service";

let database: RefCanvasDatabase | null = null;
let service: LibraryService | null = null;

afterEach(async () => {
  await service?.close();
  database?.close();
  service = null;
  database = null;
});

class BatchEnumerator implements ImportEnumerator {
  activeBatches = 0;
  maximumActiveBatches = 0;

  constructor(private readonly items: EnumeratedImportPath[]) {}

  async enumerate(
    _inputPaths: string[],
    signal: AbortSignal,
    onBatch: (items: EnumeratedImportPath[]) => Promise<void>,
  ): Promise<number> {
    for (let offset = 0; offset < this.items.length; offset += 512) {
      signal.throwIfAborted();
      this.activeBatches += 1;
      this.maximumActiveBatches = Math.max(
        this.maximumActiveBatches,
        this.activeBatches,
      );
      await onBatch(this.items.slice(offset, offset + 512));
      this.activeBatches -= 1;
    }
    return this.items.length;
  }

  close(): void {}
}

function baseAsset(filename: string, jobId: string): NewAsset {
  return {
    title: filename,
    kind: "image",
    path: filename,
    pathKey: filename.toLocaleLowerCase("en-US"),
    extension: "png",
    size: 1,
    mtimeMs: 1,
    fingerprint: filename,
    linkState: "online",
    notes: "",
    width: null,
    height: null,
    duration: null,
    metadataStatus: "pending",
    metadataError: null,
    metadataUpdatedAt: null,
    metadataJobId: jobId,
  };
}

async function waitForTerminal(
  target: LibraryService,
  id: string,
): Promise<ReturnType<LibraryService["getImportJob"]>> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    const snapshot = target.getImportJob(id);
    if (
      snapshot &&
      ["completed", "cancelled", "failed"].includes(snapshot.state)
    ) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("IMPORT_JOB_TIMEOUT");
}

describe("import coordinator", () => {
  it("serializes 512-item batches, bounds reads at 12, and commits 256 rows", async () => {
    database = new RefCanvasDatabase(":memory:");
    const enumerator = new BatchEnumerator(
      Array.from({ length: 1_024 }, (_, index) => ({
        filename: `D:\\virtual\\${index}.png`,
        sourceRoot: "D:\\virtual",
      })),
    );
    service = new LibraryService(database, undefined, { importEnumerator: enumerator });
    let activeReads = 0;
    let maximumReads = 0;
    const target = service as unknown as {
      readAssetBase(filename: string, existing: unknown, jobId: string): Promise<NewAsset>;
      extractMetadata(): Promise<{ width: number; height: number; duration: null; bpm: null }>;
    };
    target.readAssetBase = async (filename, _existing, jobId) => {
      activeReads += 1;
      maximumReads = Math.max(maximumReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeReads -= 1;
      return baseAsset(filename, jobId);
    };
    target.extractMetadata = async () => ({
      width: 1,
      height: 1,
      duration: null,
      bpm: null,
    });
    const transactionSizes: number[] = [];
    const upsertAssets = database.upsertAssets.bind(database);
    database.upsertAssets = (assets) => {
      transactionSizes.push(assets.length);
      return upsertAssets(assets);
    };

    const job = service.startImport(["D:\\virtual"]);
    const completed = await waitForTerminal(service, job.id);

    expect(completed?.state).toBe("completed");
    expect(completed?.processed).toBe(1_024);
    expect(maximumReads).toBe(12);
    expect(transactionSizes).toEqual([256, 256, 256, 256]);
    expect(enumerator.maximumActiveBatches).toBe(1);
  });

  it("cancels enrichment within one second and keeps pending base records", async () => {
    database = new RefCanvasDatabase(":memory:");
    const enumerator = new BatchEnumerator(
      Array.from({ length: 24 }, (_, index) => ({
        filename: `D:\\cancel\\${index}.png`,
        sourceRoot: null,
      })),
    );
    service = new LibraryService(database, undefined, { importEnumerator: enumerator });
    const target = service as unknown as {
      readAssetBase(filename: string, existing: unknown, jobId: string): Promise<NewAsset>;
      extractMetadata(filename: string, kind: string, signal: AbortSignal): Promise<never>;
    };
    target.readAssetBase = async (filename, _existing, jobId) =>
      baseAsset(filename, jobId);
    target.extractMetadata = async (_filename, _kind, signal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });

    const job = service.startImport(["D:\\cancel"]);
    while (service.getImportJob(job.id)?.state !== "enriching") {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const cancelledAt = Date.now();
    expect(service.cancelImport(job.id)).toBe(true);
    const cancelled = await waitForTerminal(service, job.id);

    expect(Date.now() - cancelledAt).toBeLessThan(1_000);
    expect(cancelled?.state).toBe("cancelled");
    expect(cancelled?.processed).toBe(24);
    expect(database.searchAssets({ pageSize: 100 }).items).toHaveLength(24);
    expect(database.listPendingAssetMetadata(100)).toHaveLength(24);
  });

  it("retries failed metadata on the next resume without replacing the record", async () => {
    database = new RefCanvasDatabase(":memory:");
    const enumerator = new BatchEnumerator([
      { filename: "D:\\recover\\asset.png", sourceRoot: null },
    ]);
    service = new LibraryService(database, undefined, { importEnumerator: enumerator });
    const target = service as unknown as {
      readAssetBase(filename: string, existing: unknown, jobId: string): Promise<NewAsset>;
      extractMetadata(): Promise<never>;
    };
    target.readAssetBase = async (filename, _existing, jobId) =>
      baseAsset(filename, jobId);
    target.extractMetadata = async () => {
      throw new Error("TEMPORARY_METADATA_FAILURE");
    };
    const job = service.startImport(["D:\\recover\\asset.png"]);
    const failedMetadata = await waitForTerminal(service, job.id);
    const id = database.searchAssets().items[0].id;
    expect(failedMetadata?.metadataFailed).toBe(1);
    expect(database.getAsset(id)?.metadataStatus).toBe("failed");

    await service.close();
    service = new LibraryService(database, undefined, {
      importEnumerator: new BatchEnumerator([]),
    });
    const resumed = service as unknown as {
      extractMetadata(): Promise<{ width: number; height: number; duration: null; bpm: null }>;
    };
    resumed.extractMetadata = async () => ({
      width: 640,
      height: 480,
      duration: null,
      bpm: null,
    });
    service.resumePendingMetadata();
    const started = Date.now();
    while (database.getAsset(id)?.metadataStatus !== "ready") {
      if (Date.now() - started > 2_000) throw new Error("METADATA_RESUME_TIMEOUT");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(database.getAsset(id)).toMatchObject({
      metadataStatus: "ready",
      width: 640,
      height: 480,
    });
  });
});
