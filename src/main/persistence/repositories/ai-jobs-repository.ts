/**
 * AI 任务持久化（found-clone.md §9.3）。
 *
 * `ai_jobs` 保存任务 id、Provider、外部任务 id、状态、阶段、进度、经过脱敏的
 * 请求 JSON、输出目录、输出路径、错误码、错误信息和时间戳。明文密钥、
 * 预签名 URL、完整上传响应与图片二进制一律不入库。
 */
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  AiJobSnapshot,
  AiJobState,
  AiProviderKind,
} from "../../../shared/contracts";

interface AiJobRow {
  id: string;
  provider: AiProviderKind;
  external_id: string | null;
  state: AiJobState;
  stage: string;
  progress: number | null;
  request_json: string;
  output_directory: string | null;
  outputs_json: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiJobRecord extends AiJobSnapshot {
  externalId: string | null;
  /** 脱敏后的请求 JSON（不包含路径与 token）。 */
  requestJson: string;
  outputDirectory: string | null;
}

function mapRow(row: AiJobRow): AiJobRecord {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.external_id,
    state: row.state,
    stage: row.stage,
    progress: row.progress,
    outputs: JSON.parse(row.outputs_json) as string[],
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requestJson: row.request_json,
    outputDirectory: row.output_directory,
  };
}

/** 状态迁移白名单（§9.3）。 */
const ALLOWED_TRANSITIONS: Record<AiJobState, readonly AiJobState[]> = {
  queued: ["uploading", "generating", "cancelled", "failed"],
  uploading: ["generating", "cancelled", "failed"],
  generating: ["downloading", "completed", "cancelled", "failed"],
  downloading: ["completed", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export class AiJobsRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    provider: AiProviderKind;
    externalId: string | null;
    requestJson: string;
    outputDirectory: string | null;
  }): AiJobRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ai_jobs
          (id, provider, external_id, state, stage, progress, request_json,
           output_directory, outputs_json, error_code, error_message,
           created_at, updated_at)
         VALUES (?, ?, ?, 'queued', 'queued', NULL, ?, ?, '[]', NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        input.provider,
        input.externalId,
        input.requestJson,
        input.outputDirectory,
        now,
        now,
      );
    return this.get(id)!;
  }

  get(id: string): AiJobRecord | null {
    const row = this.db.prepare("SELECT * FROM ai_jobs WHERE id = ?").get(id) as
      | AiJobRow
      | undefined;
    return row ? mapRow(row) : null;
  }

  list(limit = 100): AiJobRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM ai_jobs ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(Math.max(1, Math.min(limit, 1000))) as AiJobRow[];
    return rows.map(mapRow);
  }

  listNonTerminal(): AiJobRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM ai_jobs WHERE state IN ('queued', 'uploading', 'generating', 'downloading') ORDER BY created_at",
      )
      .all() as AiJobRow[];
    return rows.map(mapRow);
  }

  /**
   * 状态迁移。非法迁移抛 AI_JOB_INVALID_TRANSITION；
   * 终态（completed/cancelled）幂等：重复调用返回当前快照。
   */
  transition(
    id: string,
    next: AiJobState,
    patch: {
      stage?: string;
      progress?: number | null;
      externalId?: string | null;
      outputs?: string[];
      errorCode?: string | null;
      errorMessage?: string | null;
    } = {},
  ): AiJobRecord {
    const current = this.get(id);
    if (!current) throw new Error("AI_JOB_NOT_FOUND");
    const sameState = current.state === next;
    const allowed = ALLOWED_TRANSITIONS[current.state] ?? [];
    if (!sameState && !allowed.includes(next)) {
      throw new Error("AI_JOB_INVALID_TRANSITION");
    }
    // 终态重复通知保持完全幂等；运行中同状态通知仍需持久化进度/阶段。
    if (sameState && ["completed", "cancelled", "failed"].includes(current.state)) {
      return current;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE ai_jobs SET state = ?, stage = ?, progress = ?,
           external_id = ?, outputs_json = ?, error_code = ?,
           error_message = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next,
        patch.stage ?? current.stage,
        patch.progress !== undefined ? patch.progress : current.progress,
        patch.externalId !== undefined ? patch.externalId : current.externalId,
        JSON.stringify(patch.outputs ?? current.outputs),
        patch.errorCode !== undefined ? patch.errorCode : current.errorCode,
        patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
        now,
        id,
      );
    return this.get(id)!;
  }

  /** Provider 获得外部 id 后立即持久化，不依赖状态迁移。 */
  setExternalId(id: string, externalId: string): AiJobRecord {
    const current = this.get(id);
    if (!current) throw new Error("AI_JOB_NOT_FOUND");
    if (current.externalId === externalId) return current;
    this.db
      .prepare("UPDATE ai_jobs SET external_id = ?, updated_at = ? WHERE id = ?")
      .run(externalId, new Date().toISOString(), id);
    return this.get(id)!;
  }

  fail(
    id: string,
    errorCode: string,
    errorMessage: string,
  ): AiJobRecord {
    const current = this.get(id);
    if (!current) throw new Error("AI_JOB_NOT_FOUND");
    if (current.state === "completed" || current.state === "cancelled") {
      return current;
    }
    return this.transition(id, "failed", {
      stage: "failed",
      errorCode,
      errorMessage,
    });
  }

  /** 仅用于"干净中断"恢复：运行中任务在重启后被标记 failed（§9.2）。 */
  failRunningInterrupted(id: string, reason: string): AiJobRecord {
    const current = this.get(id);
    if (!current) throw new Error("AI_JOB_NOT_FOUND");
    if (!["queued", "uploading", "generating", "downloading"].includes(current.state)) {
      return current;
    }
    return this.transition(id, "failed", {
      stage: "failed",
      errorCode: "AI_JOB_INTERRUPTED",
      errorMessage: reason,
    });
  }

  /** retry 创建新尝试并关联原 job（§9.2/§9.3）；不把 failed 改回 queued。 */
  retryFrom(
    sourceJobId: string,
    provider: AiProviderKind,
    requestJson: string,
    outputDirectory: string | null,
  ): AiJobRecord {
    const source = this.get(sourceJobId);
    if (!source) throw new Error("AI_JOB_NOT_FOUND");
    return this.create({
      provider,
      requestJson,
      outputDirectory,
      externalId: null,
    });
  }

  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM ai_jobs")
      .get() as { c: number };
    return row.c;
  }
}
