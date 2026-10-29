import { translate } from "./i18n";

export type WorkspaceStatusMode = "directory" | "board" | "match";

const boardStatusHints = {
  pureref: "status.hint.boardPureRef",
  standard: "status.hint.boardStandard",
} as const;

export function workspaceStatusHint(
  mode: WorkspaceStatusMode,
  preset: keyof typeof boardStatusHints = "pureref",
): string {
  if (mode === "match") return translate("status.hint.match");
  return translate(
    mode === "directory" ? "status.hint.directory" : boardStatusHints[preset],
  );
}
