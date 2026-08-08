import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { RefCanvasDatabase } from "../persistence/database";

const SCRIPTS_KEY = "foundScripts";

export interface RegisteredScript {
  id: string;
  name: string;
  /** 脚本文件绝对路径。 */
  path: string;
  /** 注册时的 sha256（信任锚点）。 */
  hash: string;
  /** 脚本类型：py = python，ps1 = powershell，other = 直接执行。 */
  kind: "py" | "ps1" | "other";
  /** 默认超时（毫秒）。 */
  timeoutMs: number;
  createdAt: string;
}

export interface ScriptRunResult {
  exitCode: number | null;
  /** stdout + stderr（截断 64KB）。 */
  output: string;
  /** 是否超时被终止。 */
  timedOut: boolean;
  failureReason: "TIMEOUT" | "OUTPUT_LIMIT_EXCEEDED" | null;
  durationMs: number;
}

export interface ScriptsServiceOptions {
  /** 覆盖 python 可执行名（测试注入）。 */
  pythonCommand?: string;
  /** 覆盖 powershell 可执行名（测试注入）。 */
  powershellCommand?: string;
}

function terminateProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    child.kill("SIGKILL");
    return;
  }
  execFile(
    "taskkill",
    ["/pid", String(child.pid), "/T", "/F"],
    { windowsHide: true },
    () => {
      if (child.exitCode === null) child.kill();
    },
  );
}

/**
 * Python/Shell 脚本注册与运行（阶段 5 §10.5 + §15.1）。
 *
 * 信任模型：注册时记录 sha256；运行前重新计算 hash，与注册值不一致
 * 抛 SCRIPT_HASH_CHANGED（UI 必须重新确认后才能运行）。
 */
export class ScriptsService {
  private readonly pythonCommand: string;
  private readonly powershellCommand: string;

  constructor(
    private readonly database: RefCanvasDatabase,
    options: ScriptsServiceOptions = {},
  ) {
    this.pythonCommand = options.pythonCommand ?? "python";
    this.powershellCommand = options.powershellCommand ?? "powershell";
  }

  list(): RegisteredScript[] {
    return this.database.getSetting<RegisteredScript[]>(SCRIPTS_KEY, []);
  }

  async register(
    scriptPath: string,
    name: string | undefined,
    timeoutMs: number,
  ): Promise<RegisteredScript> {
    // 注册路径来自用户文件选择器。做边界校验：有界普通字符串、不含 NUL，
    // 解析后其父目录必须真实存在、文件必须是普通文件，且文件名只含
    // 安全字符（无路径分隔符/控制字符）。信任锚点是注册时记录的 sha256，
    // 运行前重新校验（SCRIPT_HASH_CHANGED）；路径从不进入 shell 拼接。
    if (
      typeof scriptPath !== "string" ||
      scriptPath.length === 0 ||
      scriptPath.length > 4096 ||
      scriptPath.includes("\0")
    ) {
      throw new Error("SCRIPT_INVALID_PATH");
    }
    const resolved = path.resolve(scriptPath);
    if (!/^[A-Za-z0-9._ -]+$/.test(path.basename(resolved))) {
      throw new Error("SCRIPT_INVALID_FILENAME");
    }
    const parent = await stat(path.dirname(resolved)).catch(() => null);
    if (!parent || !parent.isDirectory()) throw new Error("SCRIPT_DIR_NOT_FOUND");
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("SCRIPT_NOT_FOUND");
    const content = await readFile(resolved);
    const hash = createHash("sha256").update(content).digest("hex");
    const extension = path.extname(resolved).toLowerCase();
    const kind: RegisteredScript["kind"] =
      extension === ".py" ? "py" : extension === ".ps1" ? "ps1" : "other";
    const entry: RegisteredScript = {
      id: randomUUID(),
      name: name?.trim() || path.basename(resolved),
      path: resolved,
      hash,
      kind,
      timeoutMs,
      createdAt: new Date().toISOString(),
    };
    const next = [...this.list().filter((item) => item.path !== resolved), entry];
    this.database.setSetting(SCRIPTS_KEY, next);
    return entry;
  }

  unregister(id: string): void {
    this.database.setSetting(
      SCRIPTS_KEY,
      this.list().filter((item) => item.id !== id),
    );
  }

  /**
   * 运行脚本。hash 与注册时不一致抛 SCRIPT_HASH_CHANGED；
   * 超时（timeoutMs）后 kill 并返回 timedOut=true。
   */
  async run(id: string, cwd: string): Promise<ScriptRunResult> {
    const script = this.list().find((item) => item.id === id);
    if (!script) throw new Error("SCRIPT_NOT_FOUND");
    const content = await readFile(script.path).catch(() => {
      throw new Error("SCRIPT_FILE_MISSING");
    });
    const currentHash = createHash("sha256")
      .update(content)
      .digest("hex");
    if (currentHash !== script.hash) {
      throw new Error("SCRIPT_HASH_CHANGED");
    }
    const started = Date.now();
    return new Promise<ScriptRunResult>((resolve, reject) => {
      const command =
        script.kind === "py"
          ? this.pythonCommand
          : script.kind === "ps1"
            ? this.powershellCommand
            : script.path;
      const args =
        script.kind === "py"
          ? [script.path]
          : script.kind === "ps1"
            ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script.path]
            : [];
      const child = spawn(command, args, {
        cwd: path.resolve(cwd),
        windowsHide: true,
        shell: false,
      });
      const chunks: Buffer[] = [];
      let outputBytes = 0;
      let failureReason: ScriptRunResult["failureReason"] = null;
      const appendOutput = (chunk: Buffer) => {
        if (failureReason === "OUTPUT_LIMIT_EXCEEDED") return;
        outputBytes += chunk.length;
        chunks.push(chunk);
        if (outputBytes <= 65_536) return;
        failureReason = "OUTPUT_LIMIT_EXCEEDED";
        terminateProcessTree(child);
      };
      child.stdout?.on("data", (chunk: Buffer) => {
        appendOutput(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        appendOutput(chunk);
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        failureReason = "TIMEOUT";
        terminateProcessTree(child);
      }, Math.max(1_000, script.timeoutMs));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks)
          .subarray(0, 65_536)
          .toString("utf8");
        resolve({
          exitCode,
          output,
          timedOut,
          failureReason,
          durationMs: Date.now() - started,
        });
      });
    });
  }
}
