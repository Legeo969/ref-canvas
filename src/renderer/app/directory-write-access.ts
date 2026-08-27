import { translate } from "./i18n";
import { isPathInsideMount } from "./startup-navigation";

export interface DirectoryWriteResult<T> {
  completed: boolean;
  value?: T;
}

function isWriteAccessDenied(error: unknown): boolean {
  return error instanceof Error && error.message.includes("WRITE_ACCESS_DENIED");
}

/**
 * Re-authorizes an old/restored browsing location only after the user selects
 * its containing folder in the native picker. The resulting mount persists,
 * so routine writes inside it do not prompt again.
 */
export async function runWithDirectoryWriteAccess<T>(
  directoryPath: string,
  operation: () => Promise<T>,
): Promise<DirectoryWriteResult<T>> {
  try {
    return { completed: true, value: await operation() };
  } catch (error) {
    if (!isWriteAccessDenied(error)) throw error;
  }

  const selected = await window.refCanvas.system.pickDirectory({
    title: translate("directory.authorizeWrite"),
    defaultPath: directoryPath,
  });
  if (!selected || !isPathInsideMount(directoryPath, selected)) {
    return { completed: false };
  }

  await window.refCanvas.mounts.add(selected);
  return { completed: true, value: await operation() };
}
