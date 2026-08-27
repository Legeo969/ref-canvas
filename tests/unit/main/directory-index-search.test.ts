import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MAX_RETAINED_DIRECTORY_SEARCHES } from "../../../src/shared/directory-search-retention";

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
    // 路径搜索：子目录里的文件用「目录+文件名」片段也能命中（仅路径可匹配）。
    const nested = path.join(directory, "art");
    await mkdir(nested);
    await writeFile(path.join(nested, "scene.png"), "scene");

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
      expect(filteredData.entries.map((entry) => entry.name)).toEqual(["art", "model.glb"]);
      expect(filteredData.total).toBe(2);

      const filteredRevision = (filteredPage.page as { revision: string }).revision;
      receive?.({
        data: {
          id: "locate-filtered",
          type: "locate",
          directoryPath: directory,
          entryPath: path.join(
            directory,
            process.platform === "win32" ? "MODEL.GLB" : "model.glb",
          ),
          revision: filteredRevision,
          collapseSequences: true,
          extensions: ["glb"],
        },
      });
      receive?.({
        data: {
          id: "locate-filtered-out",
          type: "locate",
          directoryPath: directory,
          entryPath: path.join(directory, "notes.txt"),
          revision: filteredRevision,
          collapseSequences: true,
          extensions: ["glb"],
        },
      });
      receive?.({
        data: {
          id: "locate-collapsed-frame",
          type: "locate",
          directoryPath: directory,
          entryPath: path.join(directory, "shot_0002.exr"),
          revision: filteredRevision,
          collapseSequences: true,
        },
      });
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          const ids = new Set(messages.flatMap((message) =>
            typeof message === "object" && message !== null && "id" in message
              ? [String((message as { id?: string }).id)]
              : [],
          ));
          if (!["locate-filtered", "locate-filtered-out", "locate-collapsed-frame"]
            .every((id) => ids.has(id))) return;
          clearInterval(timer);
          resolve();
        }, 5);
      });
      const locationFor = (id: string) => (
        messages.find((message) =>
          typeof message === "object" && message !== null &&
          (message as { id?: string }).id === id,
        ) as { location?: number | null }
      ).location;
      expect(locationFor("locate-filtered")).toBe(1);
      expect(locationFor("locate-filtered-out")).toBeNull();
      expect(locationFor("locate-collapsed-frame")).toBeNull();

      // 路径片段搜索：输入 art\scene 只命中路径（文件名 scene.png 不含
      // 「art\scene」），证明地址路径可作为搜索内容。
      receive?.({
        data: {
          id: "start-path",
          type: "start-search",
          searchId: "search-path",
          directoryPath: directory,
          query: path.join("art", "scene"),
        },
      });
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          const completed = messages.some(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as { type?: string }).type === "search-progress" &&
              (message as { search?: { id?: string; state?: string } }).search
                ?.id === "search-path" &&
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
          id: "page-path",
          type: "search-page",
          searchId: "search-path",
          pageSize: 512,
          offset: 0,
        },
      });
      const pathPage = await new Promise<Record<string, unknown>>((resolve) => {
        const timer = setInterval(() => {
          const response = messages.find(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as { id?: string }).id === "page-path",
          );
          if (!response) return;
          clearInterval(timer);
          resolve(response as Record<string, unknown>);
        }, 5);
      });
      const pathData = pathPage.page as {
        entries: Array<{ path: string }>;
        total: number;
      };
      expect(pathData.total).toBe(1);
      expect(pathData.entries[0]?.path).toContain("scene.png");

      const retainedSearchIds: string[] = [];
      for (
        let index = 0;
        index < MAX_RETAINED_DIRECTORY_SEARCHES + 2;
        index += 1
      ) {
        const searchId = `retained-${index}`;
        retainedSearchIds.push(searchId);
        receive?.({
          data: {
            id: `start-${searchId}`,
            type: "start-search",
            searchId,
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
                (message as { search?: { id?: string; state?: string } }).search
                  ?.id === searchId &&
                (message as { search?: { state?: string } }).search?.state ===
                  "completed",
            );
            if (!completed) return;
            clearInterval(timer);
            resolve();
          }, 5);
        });
      }

      receive?.({
        data: {
          id: "close",
          type: "close",
        },
      });
      const cache = new Database(path.join(directory, "index.db"), {
        readonly: true,
      });
      try {
        const searchCount = cache.prepare(
          "SELECT COUNT(*) AS count FROM directory_searches",
        ).get() as { count: number };
        const orphanCount = cache.prepare(`
          SELECT COUNT(*) AS count
          FROM directory_search_entries entries
          LEFT JOIN directory_searches searches
            ON searches.search_id = entries.search_id
          WHERE searches.search_id IS NULL
        `).get() as { count: number };
        expect(searchCount.count).toBe(MAX_RETAINED_DIRECTORY_SEARCHES);
        expect(orphanCount.count).toBe(0);
        expect(cache.prepare(
          "SELECT 1 FROM directory_searches WHERE search_id = ?",
        ).get(retainedSearchIds[0])).toBeUndefined();
      } finally {
        cache.close();
      }
    } finally {
      processWithPort.parentPort = previousPort;
    }
  });
});
