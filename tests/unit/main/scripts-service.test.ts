import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScriptsService } from "../../../src/main/services/scripts-service";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";

const temporaryDirectories: string[] = [];

// Windows 自带 python；Linux/macOS 通常只有 python3。
const pythonCommand = process.platform === "win32" ? "python" : "python3";

async function withTemp(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-scripts-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createDatabase(): RefCanvasDatabase {
  return new RefCanvasDatabase(":memory:");
}

describe("ScriptsService（阶段 5 §10.5：脚本信任）", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("注册记录 sha256 信任锚点", async () => {
    const directory = await withTemp();
    const scriptPath = path.join(directory, "hello.py");
    await writeFile(scriptPath, "print('hello')\n", "utf8");
    const database = createDatabase();
    try {
      const service = new ScriptsService(database, {
        pythonCommand,
      });
      const registered = await service.register(scriptPath, "hello", 5_000);
      expect(registered.hash).toHaveLength(64);
      expect(registered.kind).toBe("py");
      expect(service.list()).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("脚本被修改后运行被拒绝（SCRIPT_HASH_CHANGED）", async () => {
    const directory = await withTemp();
    const scriptPath = path.join(directory, "mutate.py");
    await writeFile(scriptPath, "print('v1')\n", "utf8");
    const database = createDatabase();
    try {
      const service = new ScriptsService(database, {
        pythonCommand,
      });
      const registered = await service.register(scriptPath, "mutate", 5_000);
      // 修改脚本内容（hash 变化）。
      await writeFile(scriptPath, "print('v2')\n", "utf8");
      await expect(
        service.run(registered.id, directory),
      ).rejects.toThrow("SCRIPT_HASH_CHANGED");
    } finally {
      database.close();
    }
  });

  it("hash 一致时正常执行并收集输出", async () => {
    const directory = await withTemp();
    const scriptPath = path.join(directory, "echo.py");
    await writeFile(scriptPath, "print('from-script')\n", "utf8");
    const database = createDatabase();
    try {
      const service = new ScriptsService(database, {
        pythonCommand,
      });
      const registered = await service.register(scriptPath, "echo", 10_000);
      const result = await service.run(registered.id, directory);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("from-script");
      expect(result.timedOut).toBe(false);
    } finally {
      database.close();
    }
  });

  it("超时后 kill 并标记 timedOut", async () => {
    const directory = await withTemp();
    const scriptPath = path.join(directory, "slow.py");
    await writeFile(
      scriptPath,
      "import time\ntime.sleep(30)\nprint('done')\n",
      "utf8",
    );
    const database = createDatabase();
    try {
      const service = new ScriptsService(database, {
        pythonCommand,
      });
      const registered = await service.register(scriptPath, "slow", 1_000);
      const result = await service.run(registered.id, directory);
      expect(result.timedOut).toBe(true);
      expect(result.failureReason).toBe("TIMEOUT");
      expect(result.exitCode).not.toBe(0);
    } finally {
      database.close();
    }
  });

  it("输出超过 64KB 时终止进程并返回明确原因", async () => {
    const directory = await withTemp();
    const scriptPath = path.join(directory, "noisy.py");
    await writeFile(scriptPath, "print('x' * 70000, flush=True)\n", "utf8");
    const database = createDatabase();
    try {
      const service = new ScriptsService(database, {
        pythonCommand,
      });
      const registered = await service.register(scriptPath, "noisy", 10_000);
      const result = await service.run(registered.id, directory);
      expect(result.failureReason).toBe("OUTPUT_LIMIT_EXCEEDED");
      expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(65_536);
    } finally {
      database.close();
    }
  });

  it("unregister 移除注册", async () => {
    const directory = await withTemp();
    const scriptPath = path.join(directory, "gone.py");
    await writeFile(scriptPath, "print('x')\n", "utf8");
    const database = createDatabase();
    try {
      const service = new ScriptsService(database, {
        pythonCommand,
      });
      const registered = await service.register(scriptPath, "gone", 5_000);
      service.unregister(registered.id);
      expect(service.list()).toHaveLength(0);
      await expect(service.run(registered.id, directory)).rejects.toThrow(
        "SCRIPT_NOT_FOUND",
      );
    } finally {
      database.close();
    }
  });
});
