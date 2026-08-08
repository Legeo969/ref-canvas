/**
 * 统一任务中心 IPC（FND-007 §8.3）。
 *
 * Renderer 只读聚合任务列表并可请求取消（取消幂等）；进度经 `tasks:changed`
 * 广播（TaskSnapshot，无任意目录扫描能力）。
 */
import { z } from "zod";
import type { TaskCenterService } from "../services/task-center-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";

const taskListSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

const taskIdSchema = z.string().min(1).max(128);

export interface TaskCenterIpcDependencies {
  getTaskCenter(): TaskCenterService;
}

export function registerTaskCenterIpc(
  ipc: SecureIpcRegistrar,
  dependencies: TaskCenterIpcDependencies,
): void {
  ipc.handle("tasks:list", (input) => {
    const parsed = taskListSchema.parse(input ?? {});
    return dependencies.getTaskCenter().list(parsed.limit);
  });

  ipc.handle("tasks:get", (id) => {
    return dependencies.getTaskCenter().get(taskIdSchema.parse(id));
  });

  ipc.handle("tasks:cancel", (id) => {
    return dependencies.getTaskCenter().cancel(taskIdSchema.parse(id));
  });
}
