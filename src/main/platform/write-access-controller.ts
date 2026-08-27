import type { BrowserWindow } from "electron";
import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  canonicalizeLocalPath,
  driveForLocalPath,
  isPathInsideRoot,
  type CanonicalPathMode,
} from "./local-path-security";

export type WriteOperation =
  | "mount"
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
  scopePath: string;
  representativePath: string;
  window: BrowserWindow;
}

export type WriteGrantPrompter = (request: WriteGrantPrompt) => Promise<boolean>;

async function defaultPrompt(): Promise<boolean> {
  return false;
}

function scopeKey(filename: string): string {
  const normalized = path.normalize(filename);
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

const directFileOperations = new Set<WriteOperation>([
  "rename",
  "trash",
  "copy",
  "move",
  "create-folder",
]);

async function authorizationScope(
  filename: string,
  mode: CanonicalPathMode,
): Promise<string> {
  if (mode === "destination") {
    const info = await lstat(filename).catch(() => null);
    if (info?.isDirectory()) return filename;
  }
  return path.dirname(filename);
}

/** Main-process-only, per-directory, in-memory write capability manager. */
export class WriteAccessController {
  private readonly grantedScopes = new Map<string, { path: string; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(
    private readonly implicitRoots: () => string[],
    private readonly prompt: WriteGrantPrompter = defaultPrompt,
  ) {}

  clear(): void {
    this.grantedScopes.clear();
    this.pending.clear();
  }

  /**
   * Records a capability created by a native file/directory picker. The grant
   * is process-local and expires; it is never accepted from renderer input.
   */
  async authorizePickerSelection(
    requests: WritePathRequest[],
    ttlMs = 30 * 60 * 1_000,
  ): Promise<string[]> {
    const checked = await Promise.all(
      requests.map(async (request) => ({
        canonical: await canonicalizeLocalPath(request.path, request.mode),
        mode: request.mode,
      })),
    );
    const expiresAt = Date.now() + ttlMs;
    for (const item of checked) {
      const scopePath = await authorizationScope(item.canonical, item.mode);
      this.grantedScopes.set(scopeKey(scopePath), { path: scopePath, expiresAt });
    }
    return checked.map((item) => item.canonical);
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
        mode: request.mode,
      })),
    );
    // Direct file-manager commands are already explicit user actions. Keep
    // canonical path validation, but do not add a second permission prompt.
    if (directFileOperations.has(operation)) {
      return checked.map((item) => item.canonical);
    }
    const implicit = this.implicitRoots();
    const now = Date.now();
    for (const [key, grant] of this.grantedScopes) {
      if (grant.expiresAt <= now) this.grantedScopes.delete(key);
    }
    const candidates = new Map<
      string,
      { drive: string; scopePath: string; representativePath: string }
    >();
    for (const item of checked) {
      for (const filename of [item.lexical, item.canonical]) {
        if (implicit.some((root) => isPathInsideRoot(filename, root))) continue;
        const scopePath = await authorizationScope(filename, item.mode);
        candidates.set(scopeKey(scopePath), {
          drive: driveForLocalPath(filename),
          scopePath,
          representativePath: filename,
        });
      }
    }
    for (const [key, candidate] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
      if ([...this.grantedScopes.values()].some((grant) =>
        isPathInsideRoot(candidate.scopePath, grant.path))) continue;
      let decision = this.pending.get(key);
      if (!decision) {
        decision = this.prompt({ operation, ...candidate, window })
          .then((allowed) => {
            if (allowed) {
              for (const [grantedKey, grant] of this.grantedScopes) {
                if (isPathInsideRoot(grant.path, candidate.scopePath)) {
                  this.grantedScopes.delete(grantedKey);
                }
              }
              this.grantedScopes.set(key, {
                path: candidate.scopePath,
                expiresAt: Date.now() + 30 * 60 * 1_000,
              });
            }
            return allowed;
          })
          .finally(() => this.pending.delete(key));
        this.pending.set(key, decision);
      }
      if (!(await decision)) throw new Error("WRITE_ACCESS_DENIED");
    }
    return checked.map((item) => item.canonical);
  }
}
