import type { MountRoot } from "../../shared/contracts";
import { useAppStore } from "./store";
import type { ConfirmDialogConfig } from "../components/DialogProvider";

interface ConfirmationDialog {
  requestConfirm(config: ConfirmDialogConfig): Promise<boolean>;
}

export async function confirmRemoveMount(
  dialog: ConfirmationDialog,
  mount: Pick<MountRoot, "id" | "displayName" | "path">,
): Promise<boolean> {
  const confirmed = await dialog.requestConfirm({
    title: `移除挂载“${mount.displayName}”？`,
    description: "只停止浏览这个目录。磁盘文件、标签、评分和备注都不会被删除。",
    confirmLabel: "移除挂载",
  });
  if (!confirmed) return false;
  await window.refCanvas.mounts.remove(mount.id);
  useAppStore.getState().clearRemovedMount(mount.path);
  return true;
}
