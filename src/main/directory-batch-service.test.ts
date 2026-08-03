import { describe, expect, it } from "vitest";
import { DirectoryBatchService } from "./directory-batch-service";

describe("DirectoryBatchService", () => {
  it("resolves all-result selections page by page with exclusions", async () => {
    const processed: string[] = [];
    const service = new DirectoryBatchService({
      resolveSelection: async (selection, offset) => {
        expect(selection.revision).toBe("revision-1");
        expect(selection.excludedPaths).toEqual(["C:\\assets\\b.png"]);
        return offset === 0
          ? { paths: ["C:\\assets\\a.png"], nextOffset: 2, total: 2 }
          : { paths: ["C:\\assets\\c.png"], nextOffset: null, total: 2 };
      },
      process: async (filename) => {
        processed.push(filename);
      },
    });
    const started = service.start(
      {
        mode: "all",
        directoryPath: "C:\\assets",
        revision: "revision-1",
        excludedPaths: ["C:\\assets\\b.png"],
      },
      { type: "materialize" },
    );
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (service.get(started.id)?.state !== "running") break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(service.get(started.id)).toMatchObject({
      state: "completed",
      total: 2,
      processed: 2,
    });
    expect(processed).toEqual(["C:\\assets\\a.png", "C:\\assets\\c.png"]);
  });

  it("reports stale revision failures without processing files", async () => {
    const service = new DirectoryBatchService({
      resolveSelection: async () => {
        throw new Error("DIRECTORY_REVISION_CHANGED");
      },
      process: async () => undefined,
    });
    const started = service.start(
      {
        mode: "all",
        directoryPath: "C:\\assets",
        revision: "stale",
        excludedPaths: [],
      },
      { type: "trash" },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(service.get(started.id)).toMatchObject({ state: "failed" });
    expect(service.get(started.id)?.failed[0].reason).toBe(
      "DIRECTORY_REVISION_CHANGED",
    );
  });
});
