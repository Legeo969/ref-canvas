import type { BrowserWindow } from "electron";
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
  | "execute"
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

async function defaultPrompt(): Promise<boolean> {
  // Desktop file operations are already initiated explicitly by the user.
  // Keep canonical path checks, but do not interrupt the first operation on a drive.
  return true;
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
