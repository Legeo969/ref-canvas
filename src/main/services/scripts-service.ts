import { spawn } from "node:child_process";
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
  durationMs: number;
}

export interface ScriptsServiceOptions {
  /** 覆盖 python 可执行名（测试注入）。 */
  pythonCommand?: string;
  /** 覆盖 powershell 可执行名（测试注入）。 */
  powershellCommand?: string;
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
    const resolved = path.resolve(scriptPath);
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
      child.stdout?.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length > 65_536) child.kill();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length > 65_536) child.kill();
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, Math.max(1_000, script.timeoutMs));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks)
          .toString("utf8")
          .slice(0, 65_536);
        resolve({
          exitCode,
          output,
          timedOut,
          durationMs: Date.now() - started,
        });
      });
    });
  }
}
