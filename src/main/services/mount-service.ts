import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import type { MountRoot } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";

/**
 * Mount 状态机（计划 §7.5）。
 *
 * 每个 watch root 视为一个挂载根。探测其可达性并持久化到 mount_roots：
 * - online：stat 成功。
 * - offline：stat 超时/路径不存在（磁盘或 NAS 断连）。
 * - permission-denied：路径存在但无权限。
 *
 * 离线语义（§7.5）：mount 离线时把其下资产标记为 offline（绝不批量删除），
 * 恢复时由调用方执行增量 reconcile。状态变化通过事件通知。
 */
export class MountService {
  private readonly events = new EventEmitter();
  /** 探测超时（ms）。 */
  private readonly probeTimeoutMs: number;

  constructor(
    private readonly database: RefCanvasDatabase,
    options: { probeTimeoutMs?: number } = {},
  ) {
    this.probeTimeoutMs = options.probeTimeoutMs ?? 1_500;
  }

  onMountStateChanged(
    listener: (change: { mountId: string; state: MountRoot["state"] }) => void,
  ): () => void {
    this.events.on("mount-state", listener);
    return () => this.events.off("mount-state", listener);
  }

  private async probe(pathname: string): Promise<MountRoot["state"]> {
    try {
      const info = await Promise.race([
        stat(pathname),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("MOUNT_PROBE_TIMEOUT")), this.probeTimeoutMs),
        ),
      ]);
      return info.isDirectory() ? "online" : "permission-denied";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EACCES") {
        return "permission-denied";
      }
      return "offline";
    }
  }

  /** 刷新单个挂载根状态；变化时持久化并发出事件。 */
  async refreshMount(mountId: string): Promise<MountRoot["state"]> {
    const mount = this.database.listMountRoots().find((item) => item.id === mountId);
    if (!mount) throw new Error("MOUNT_NOT_FOUND");
    const state = await this.probe(mount.path);
    if (state !== mount.state) {
      this.database.upsertMountRoot({
        id: mount.id,
        path: mount.path,
        displayName: mount.displayName,
        volumeId: mount.volumeId,
        state,
      });
      // 离线：该 mount 下资产标记 offline，不做批量删除（§7.5）。
      if (state === "offline") {
        this.database.markIdentitiesOfflineByMount(mountId);
      }
      this.events.emit("mount-state", { mountId, state });
    }
    return state;
  }

  /** 刷新全部挂载根；返回状态变化列表。 */
  async refreshAll(): Promise<
    Array<{ mountId: string; state: MountRoot["state"] }>
  > {
    const mounts = this.database.listMountRoots();
    const changes: Array<{ mountId: string; state: MountRoot["state"] }> = [];
    for (const mount of mounts) {
      const state = await this.refreshMount(mount.id);
      if (state !== mount.state) changes.push({ mountId: mount.id, state });
    }
    return changes;
  }
}
