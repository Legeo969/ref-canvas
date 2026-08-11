import type { BrowserWindow } from "electron";
import { dialog } from "electron";
import {
  canonicalizeLocalPath,
  driveForLocalPath,
  isPathInsideRoot,
  type CanonicalPathMode,
} from "./local-path-security";

export type WriteOperation =
  | "rename"
  | "trash"
  | "copy"
  | "move"
  | "create-folder"
  | "archive"
  | "export";

export interface WritePathRequest {
  path: string;
  mode: CanonicalPathMode;
}

export interface WriteGrantPrompt {
  operation: WriteOperation;
  drive: string;
  representativePath: string;
  window: BrowserWindow;
}

export type WriteGrantPrompter = (request: WriteGrantPrompt) => Promise<boolean>;

const operationLabels: Record<WriteOperation, string> = {
  rename: "重命名",
  trash: "移入回收站",
  copy: "复制写入",
  move: "移动",
  "create-folder": "创建文件夹",
  archive: "创建归档",
  export: "导出文件",
};

async function defaultPrompt(request: WriteGrantPrompt): Promise<boolean> {
  const result = await dialog.showMessageBox(request.window, {
    type: "warning",
    title: "允许本次会话写入磁盘？",
    message: `RefCanvas 请求在 ${request.drive} 盘执行“${operationLabels[request.operation]}”。`,
    detail: `代表性目标：${request.representativePath}\n\n允许后，本次应用运行期间可继续写入整个 ${request.drive} 盘；退出 RefCanvas 后授权自动失效。`,
    buttons: ["取消", "允许本次会话"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}

/** Main-process-only, per-drive, in-memory write capability manager. */
export class WriteAccessController {
  private readonly grantedDrives = new Set<string>();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(
    private readonly implicitRoots: () => string[],
    private readonly prompt: WriteGrantPrompter = defaultPrompt,
  ) {}

  clear(): void {
    this.grantedDrives.clear();
    this.pending.clear();
  }

  async authorize(
    window: BrowserWindow,
    operation: WriteOperation,
    requests: WritePathRequest[],
  ): Promise<string[]> {
    if (requests.length === 0) return [];
    const checked = await Promise.all(
      requests.map(async (request) => ({
        lexical: request.path,
        canonical: await canonicalizeLocalPath(request.path, request.mode),
      })),
    );
    const implicit = this.implicitRoots();
    const candidates = new Map<string, string>();
    for (const item of checked) {
      for (const filename of [item.lexical, item.canonical]) {
        if (implicit.some((root) => isPathInsideRoot(filename, root))) continue;
        candidates.set(driveForLocalPath(filename), filename);
      }
    }
    for (const [drive, representativePath] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
      if (this.grantedDrives.has(drive)) continue;
      let decision = this.pending.get(drive);
      if (!decision) {
        decision = this.prompt({ operation, drive, representativePath, window })
          .then((allowed) => {
            if (allowed) this.grantedDrives.add(drive);
            return allowed;
          })
          .finally(() => this.pending.delete(drive));
        this.pending.set(drive, decision);
      }
      if (!(await decision)) throw new Error("WRITE_ACCESS_DENIED");
    }
    return checked.map((item) => item.canonical);
  }
}
