import type { MountRoot } from "../../shared/contracts";
import { useAppStore } from "./store";
import { translate } from "./i18n";
import type { ConfirmDialogConfig } from "../components/DialogProvider";

interface ConfirmationDialog {
  requestConfirm(config: ConfirmDialogConfig): Promise<boolean>;
}

export async function confirmRemoveMount(
  dialog: ConfirmationDialog,
  mount: Pick<MountRoot, "id" | "displayName" | "path">,
): Promise<boolean> {
  const confirmed = await dialog.requestConfirm({
    title: translate("directory.unmountNamed").replace("{name}", mount.displayName),
    description: translate("directory.unmountDescription"),
    confirmLabel: translate("directory.unmount"),
  });
  if (!confirmed) return false;
  await window.refCanvas.mounts.remove(mount.id);
  useAppStore.getState().clearRemovedMount(mount.path);
  return true;
}
