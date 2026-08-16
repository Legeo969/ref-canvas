import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

type Message = Record<string, unknown>;

type ParentPort = {
  postMessage(message: unknown): void;
  on(
    event: "message",
    listener: (event: { data: Message }) => void,
  ): void;
};

interface Harness {
  send(request: Message): void;
  waitFor(predicate: (message: Message) => boolean): Promise<Message>;
  list(
    directoryPath: string,
    options: { favoritesOnly?: boolean; favoritePaths?: string[] },
  ): Promise<Message>;
}

let harness: Harness;
let databasePath: string;

beforeAll(async () => {
  // worker 的数据库句柄全程打开：DB 文件放在独立临时目录，
  // 与按用例清理的素材目录分离，避免 Windows 上删除占用中的文件失败。
  const dbDirectory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fav-db-"));
  databasePath = path.join(dbDirectory, "index.db");
  const messages: Message[] = [];
  let receive: ((event: { data: Message }) => void) | undefined;
  const parentPort: ParentPort = {
    postMessage: (message) => messages.push(message as Message),
    on: (_event, listener) => {
      receive = listener;
    },
  };
  const processWithPort = process as unknown as { parentPort?: ParentPort };
  processWithPort.parentPort = parentPort;
  await import("../../../src/workers/directory-index");

  const waitFor = (predicate: (message: Message) => boolean) =>
    new Promise<Message>((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const found = messages.find(predicate);
        if (found) {
          clearInterval(timer);
          resolve(found);
          return;
        }
        if (Date.now() - start > 5_000) {
          clearInterval(timer);
          reject(new Error("directory worker reply timeout"));
        }
      }, 5);
    });

  const send = (request: Message) => receive?.({ data: request });

  harness = {
    send,
    waitFor,
    list: (directoryPath, options) => {
      const id = `list-${Math.random().toString(16).slice(2)}`;
      send({
        id,
        type: "list",
        databasePath,
        directoryPath,
        offset: 0,
        pageSize: 512,
        collapseSequences: true,
        favoritesOnly: options.favoritesOnly,
        favoritePaths: options.favoritePaths,
      });
      return waitFor((message) => message.id === id);
    },
  };
});

afterAll(async () => {
  // 先让 worker 关闭数据库（Windows 上打开中的 SQLite 文件无法删除）。
  harness.send({ id: "close", type: "close" });
  await rm(path.dirname(databasePath), { recursive: true, force: true });
});

describe("directory index favorites filter", () => {
  it("favoritesOnly 只返回收藏素材并隐藏文件夹", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fav-"));
    temporaryDirectories.push(directory);
    await mkdir(path.join(directory, "art"));
    await Promise.all([
      writeFile(path.join(directory, "keep.png"), ""),
      writeFile(path.join(directory, "skip.png"), ""),
      writeFile(path.join(directory, "keep.psd"), ""),
    ]);

    const reply = await harness.list(directory, {
      favoritesOnly: true,
      favoritePaths: [path.join(directory, "keep.png")],
    });
    const page = reply.page as {
      entries: Array<{ path: string; isDirectory: boolean }>;
      total: number;
    };
    expect(page.entries.map((entry) => path.basename(entry.path))).toEqual([
      "keep.png",
    ]);
    expect(page.entries.every((entry) => !entry.isDirectory)).toBe(true);
    expect(page.total).toBe(1);
  });

  it("favoritesOnly 且收藏集为空时返回空页", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fav-"));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, "a.png"), "");

    const reply = await harness.list(directory, {
      favoritesOnly: true,
      favoritePaths: [],
    });
    const page = reply.page as {
      entries: Array<{ path: string }>;
      total: number;
    };
    expect(page.entries).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("不开启 favoritesOnly 时返回全部条目", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fav-"));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(path.join(directory, "keep.png"), ""),
      writeFile(path.join(directory, "skip.png"), ""),
    ]);

    const reply = await harness.list(directory, {});
    const page = reply.page as {
      entries: Array<{ path: string }>;
      total: number;
    };
    expect(page.entries.map((entry) => path.basename(entry.path)).sort()).toEqual([
      "keep.png",
      "skip.png",
    ]);
    expect(page.total).toBe(2);
  });

  it("resolve-selection 在 favoritesOnly 下只选中收藏素材", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fav-"));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(path.join(directory, "keep.png"), ""),
      writeFile(path.join(directory, "skip.png"), ""),
    ]);

    const listReply = await harness.list(directory, {
      favoritesOnly: true,
      favoritePaths: [path.join(directory, "keep.png")],
    });
    const revision = (listReply.page as { revision?: string }).revision;

    const id = `selection-${Math.random().toString(16).slice(2)}`;
    harness.send({
      id,
      type: "resolve-selection",
      databasePath,
      directoryPath: directory,
      revision,
      excludedPaths: [],
      offset: 0,
      pageSize: 1_000,
      favoritesOnly: true,
      favoritePaths: [path.join(directory, "keep.png")],
    });
    const reply = await harness.waitFor((message) => message.id === id);
    const selection = reply.selection as {
      paths: string[];
      total: number;
    };
    expect(selection.paths).toEqual([path.join(directory, "keep.png")]);
    expect(selection.total).toBe(1);
  });
});
