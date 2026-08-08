import { stat } from "node:fs/promises";
import path from "node:path";
import type { RefCanvasDatabase } from "../persistence/database";
import { quickFingerprint } from "./library-service";

/**
 * Board V4 引用解析（计划 §11）。
 *
 * 打开 Board 时批量解析引用（Promise.all 并行 stat，不做同步磁盘 IO）：
 * - 路径存在且 mtime+size 一致 → online（快速路径）
 * - mtime/size 变化但 quickFingerprint 仍一致 → online（复制/触摸场景）
 * - 路径缺失或内容变化 → 按 fingerprint 在 file_identities 搜索：
 *   唯一候选自动重连（更新 asset path）；多候选 → ambiguous + candidates；
 *   无候选 → missing（对象保留，不破坏 Board document）。
 */

export interface BoardReferenceCandidate {
  path: string;
  assetId: string | null;
}

export interface BoardReferenceResolutionV4 {
  assetId: string;
  path: string | null;
  state: "online" | "missing" | "offline" | "ambiguous";
  /** fingerprint 搜索候选（ambiguous 时供 relink UI 选择）。 */
  candidates: BoardReferenceCandidate[];
  /** 本次是否自动重连（fingerprint 匹配 → path 已更新）。 */
  relinked: boolean;
}

export class BoardReferenceService {
  constructor(private readonly database: RefCanvasDatabase) {}

  /** 批量解析 Board 全部引用（并行，不阻塞主线程）。 */
  resolveReferences(boardId: string): Promise<BoardReferenceResolutionV4[]> {
    const assetIds = this.database.getBoardAssetIds(boardId);
    return Promise.all(
      assetIds.map((assetId) => this.resolveOne(assetId)),
    );
  }

  private async resolveOne(assetId: string): Promise<BoardReferenceResolutionV4> {
    const asset = this.database.getAsset(assetId);
    if (!asset) {
      // 资产记录已删除：对象保留在 Board 上，状态 missing。
      return {
        assetId,
        path: null,
        state: "missing",
        candidates: [],
        relinked: false,
      };
    }
    if (asset.linkState === "offline") {
      return {
        assetId,
        path: asset.path,
        state: "offline",
        candidates: [],
        relinked: false,
      };
    }
    const current = await stat(asset.path).catch(() => null);
    if (current?.isFile()) {
      if (current.size === asset.size && current.mtimeMs === asset.mtimeMs) {
        // 快速路径：mtime+size 一致 → 未变化。
        return {
          assetId,
          path: asset.path,
          state: "online",
          candidates: [],
          relinked: false,
        };
      }
      // 元数据变了：重算 quickFingerprint 确认内容是否一致。
      const fingerprint = await quickFingerprint(asset.path, current.size);
      if (fingerprint === asset.fingerprint) {
        return {
          assetId,
          path: asset.path,
          state: "online",
          candidates: [],
          relinked: false,
        };
      }
    }
    // 路径缺失或内容变化：按 fingerprint 搜索新位置。
    return this.findByFingerprint(asset);
  }

  private async findByFingerprint(
    asset: NonNullable<ReturnType<RefCanvasDatabase["getAsset"]>>,
  ): Promise<BoardReferenceResolutionV4> {
    const matches = this.database
      .findIdentityByFingerprint(asset.fingerprint, asset.size)
      .filter(
        (match) =>
          match.assetId !== asset.id &&
          match.pathKey !== path.normalize(asset.path).toLocaleLowerCase("en-US"),
      );
    const candidates: BoardReferenceCandidate[] = matches.map((match) => {
      // pathKey 是全小写；用 root_path（原始大小写）还原真实路径。
      // Windows 大小写不敏感，相对段小写不影响访问。
      const realPath = match.rootPath
        ? path.join(
            match.rootPath,
            match.pathKey.slice(match.rootPath.toLocaleLowerCase("en-US").length).replace(/^[\\/]+/, ""),
          )
        : match.pathKey;
      return {
        path: realPath,
        assetId: match.assetId || null,
      };
    });
    if (candidates.length === 1) {
      // 唯一候选：自动重连（§11：路径变化但 fingerprint 匹配时自动更新引用）。
      const candidate = candidates[0];
      const fileStat = await stat(candidate.path).catch(() => null);
      if (!fileStat?.isFile()) {
        return {
          assetId: asset.id,
          path: null,
          state: "missing",
          candidates: [],
          relinked: false,
        };
      }
      this.database.relinkAsset(asset.id, {
        kind: asset.kind,
        path: candidate.path,
        pathKey: path.normalize(candidate.path).toLocaleLowerCase("en-US"),
        extension: asset.extension,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        fingerprint: asset.fingerprint,
        contentHash: null,
        storageMode: "linked",
        linkState: "online",
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
        bpm: asset.bpm,
        customFields: asset.customFields,
        notes: asset.notes,
        title: asset.title,
      });
      return {
        assetId: asset.id,
        path: candidate.path,
        state: "online",
        candidates: [],
        relinked: true,
      };
    }
    if (candidates.length > 1) {
      return {
        assetId: asset.id,
        path: null,
        state: "ambiguous",
        candidates,
        relinked: false,
      };
    }
    return {
      assetId: asset.id,
      path: null,
      state: "missing",
      candidates: [],
      relinked: false,
    };
  }
}
