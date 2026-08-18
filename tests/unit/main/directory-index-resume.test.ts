import Database from "better-sqlite3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
});

type Message = Record<string, unknown>;
type ParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: Message }) => void): void;
};

let databasePath: string;
const messages: Message[] = [];
let receive: ((event: { data: Message }) => void) | undefined;

beforeAll(async () => {
  // 独立 DB 目录，避免 Windows 删除占用中文件的竞态。
  const dbDirectory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-resume-db-"));
  databasePath = path.join(dbDirectory, "index.db");
  const parentPort: ParentPort = {
    postMessage: (message) => messages.push(message as Message),
    on: (_event, listener) => {
      receive = listener;
    },
  };
  const processWithPort = process as unknown as { parentPort?: ParentPort };
  processWithPort.parentPort = parentPort;
  await import("../../../src/workers/directory-index");
});

afterAll(async () => {
  const dir = path.dirname(databasePath);
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

function waitFor(predicate: (message: Message) => boolean): Promise<Message> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if (Date.now() - start > 10_000) {
        clearInterval(timer);
        reject(new Error("timed out waiting for worker message"));
      }
    }, 5);
  });
}

describe("SPEC-3 directory scan resume", () => {
  it("resumes an interrupted scanning directory without deleting existing entries", async () => {
    // 素材目录：3 个文件，模拟已扫到第 2 个时中断。
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-resume-dir-"));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, "a.png"), "a");
    await writeFile(path.join(directory, "b.png"), "b");
    await writeFile(path.join(directory, "c.png"), "c");
    // 获取目录 mtime 作为缓存校验值（扫描完成事务写入的值）。
    const info = await import("node:fs/promises").then((fs) => fs.stat(directory));

    // 预置 `state='scanning'` + 已扫部分条目（模拟 worker 崩溃留下的现场）。
    // 手动建表（与 worker 的 DDL 一致），因为 worker 只在收到带 databasePath
    // 的消息时才建表。
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS directory_scans (
        directory_path TEXT PRIMARY KEY,
        revision TEXT NOT NULL,
        directory_mtime_ms REAL NOT NULL,
        state TEXT NOT NULL,
        discovered INTEGER NOT NULL,
        file_total INTEGER NOT NULL,
        last_access_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS directory_entries (
        directory_path TEXT NOT NULL,
        entry_path TEXT NOT NULL,
        name TEXT NOT NULL,
        is_directory INTEGER NOT NULL,
        extension TEXT NOT NULL,
        discovery_ordinal INTEGER NOT NULL,
        size INTEGER,
        mtime_ms REAL,
        sequence_json TEXT,
        PRIMARY KEY(directory_path, entry_path)
      );
      CREATE INDEX IF NOT EXISTS directory_entries_discovery
        ON directory_entries(directory_path, discovery_ordinal);
    `);
    db.prepare(`
      INSERT INTO directory_scans(
        directory_path, revision, directory_mtime_ms, state, discovered, file_total, last_access_ms
      ) VALUES (?, 'rev-scanning', ?, 'scanning', 2, 2, ?)
    `).run(directory, info.mtimeMs, Date.now());
    db.prepare(`
      INSERT INTO directory_entries(directory_path, entry_path, name, is_directory, extension, discovery_ordinal)
      VALUES (?, ?, 'a.png', 0, 'png', 0), (?, ?, 'b.png', 0, 'png', 1)
    `).run(
      directory,
      path.join(directory, "a.png"),
      directory,
      path.join(directory, "b.png"),
    );
    db.close();

    // 触发 list：应续扫（保留 a/b），并追加 c，最终 complete。
    receive?.({
      data: {
        id: "resume-list",
        type: "list",
        databasePath,
        directoryPath: directory,
        pageSize: 512,
        offset: 0,
      },
    });
    const page = await waitFor(
      (message) => message.id === "resume-list" && message.page !== undefined,
    );

    const pageData = page.page as {
      entries: Array<{ name: string }>;
      total: number;
    };
    // 续扫完成后总数为 3，且已扫部分仍可见（不重复、不丢失）。
    expect(pageData.total).toBe(3);
    const names = pageData.entries.map((entry) => entry.name).sort();
    expect(names).toEqual(["a.png", "b.png", "c.png"]);

    // 确认 DB 中 state 已置 complete、file_total=3，且 a/b 未被删除重建。
    const check = new Database(databasePath);
    const scan = check
      .prepare("SELECT state, file_total, discovered FROM directory_scans WHERE directory_path = ?")
      .get(directory) as { state: string; file_total: number; discovered: number };
    expect(scan.state).toBe("complete");
    expect(scan.file_total).toBe(3);
    expect(scan.discovered).toBe(3);
    const count = check
      .prepare("SELECT COUNT(*) AS n FROM directory_entries WHERE directory_path = ?")
      .get(directory) as { n: number };
    expect(count.n).toBe(3);
    check.close();

    receive?.({ data: { id: "resume-close", type: "close" } });
  });
});
