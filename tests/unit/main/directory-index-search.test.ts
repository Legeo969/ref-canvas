import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("directory index search", () => {
  it("folds or exposes image sequences according to the search option", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-search-"));
    temporaryDirectories.push(directory);
    for (const frame of [1, 2, 3]) {
      await writeFile(
        path.join(directory, `shot_${String(frame).padStart(4, "0")}.exr`),
        "",
      );
    }
    await writeFile(path.join(directory, "model.glb"), "model");
    await writeFile(path.join(directory, "notes.txt"), "notes");

    type ParentPort = {
      postMessage(message: unknown): void;
      on(
        event: "message",
        listener: (event: { data: Record<string, unknown> }) => void,
      ): void;
    };
    const messages: unknown[] = [];
    let receive:
      | ((event: { data: Record<string, unknown> }) => void)
      | undefined;
    const parentPort: ParentPort = {
      postMessage: (message) => messages.push(message),
      on: (_event, listener) => {
        receive = listener;
      },
    };
    const processWithPort = process as unknown as {
      parentPort?: ParentPort;
    };
    const previousPort = processWithPort.parentPort;
    processWithPort.parentPort = parentPort;
    try {
      await import("../../../src/workers/directory-index");
      receive?.({
        data: {
          id: "start",
          type: "start-search",
          searchId: "search-1",
          databasePath: path.join(directory, "index.db"),
          directoryPath: directory,
          query: "shot",
        },
      });
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          const completed = messages.some(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as { type?: string }).type === "search-progress" &&
              (message as { search?: { state?: string } }).search?.state ===
                "completed",
          );
          if (!completed) return;
          clearInterval(timer);
          resolve();
        }, 5);
      });

      receive?.({
        data: {
          id: "page",
          type: "search-page",
          searchId: "search-1",
          pageSize: 512,
          offset: 0,
        },
      });
      const page = await new Promise<Record<string, unknown>>((resolve) => {
        const timer = setInterval(() => {
          const response = messages.find(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as { id?: string }).id === "page",
          );
          if (!response) return;
          clearInterval(timer);
          resolve(response as Record<string, unknown>);
        }, 5);
      });
      const pageData = page.page as {
        entries: Array<{ path: string; sequence?: { frame: number } }>;
        total: number;
      };
      expect(pageData.total).toBe(1);
      expect(pageData.entries).toHaveLength(1);
      expect(pageData.entries[0]?.path).toContain("shot_0001.exr");
      expect(pageData.entries[0]?.sequence?.frame).toBe(1);

      receive?.({
        data: {
          id: "start-expanded",
          type: "start-search",
          searchId: "search-expanded",
          directoryPath: directory,
          query: "shot",
          collapseSequences: false,
        },
      });
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          const completed = messages.some(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as { type?: string }).type === "search-progress" &&
              (message as { search?: { id?: string; state?: string } }).search?.id ===
                "search-expanded" &&
              (message as { search?: { state?: string } }).search?.state ===
                "completed",
          );
          if (!completed) return;
          clearInterval(timer);
          resolve();
        }, 5);
      });
      receive?.({
        data: {
          id: "page-expanded",
          type: "search-page",
          searchId: "search-expanded",
          pageSize: 512,
          offset: 0,
        },
      });
      const expandedPage = await new Promise<Record<string, unknown>>((resolve) => {
        const timer = setInterval(() => {
          const response = messages.find(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as { id?: string }).id === "page-expanded",
          );
          if (!response) return;
          clearInterval(timer);
          resolve(response as Record<string, unknown>);
        }, 5);
      });
      expect((expandedPage.page as { total: number }).total).toBe(3);

      receive?.({
        data: {
          id: "list-filtered",
          type: "list",
          databasePath: path.join(directory, "index.db"),
          directoryPath: directory,
          pageSize: 512,
          offset: 0,
          extensions: ["glb"],
        },
      });
      const filteredPage = await new Promise<Record<string, unknown>>((resolve) => {
        const timer = setInterval(() => {
          const response = messages.find(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as { id?: string }).id === "list-filtered",
          );
          if (!response) return;
          clearInterval(timer);
          resolve(response as Record<string, unknown>);
        }, 5);
      });
      const filteredData = filteredPage.page as {
        entries: Array<{ name: string; isDirectory: boolean }>;
        total: number;
      };
      expect(filteredData.entries.map((entry) => entry.name)).toEqual(["model.glb"]);
      expect(filteredData.total).toBe(1);

      receive?.({
        data: {
          id: "close",
          type: "close",
        },
      });
    } finally {
      processWithPort.parentPort = previousPort;
    }
  });
});
