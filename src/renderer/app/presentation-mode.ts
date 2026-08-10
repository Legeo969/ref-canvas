/** Presentation is a board-only surface, even if the native window reports fullscreen. */
export function presentationModeForWorkspace(
  nativeFullscreen: boolean,
  workspaceMode: "directory" | "board",
): boolean {
  return nativeFullscreen && workspaceMode === "board";
}

/**
 * F11 is reserved by RefCanvas so Chromium cannot accidentally turn the disk
 * workspace into board presentation mode. Returns the requested native state,
 * or null when no native transition is needed.
 */
export function presentationTargetForF11(
  active: boolean,
  workspaceMode: "directory" | "board",
): boolean | null {
  if (workspaceMode !== "board") return active ? false : null;
  return !active;
}
