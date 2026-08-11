import { useEffect, useEffectEvent } from "react";
import {
  shortcutMatches,
  type BoardShortcutBindings,
  type BoardShortcutId,
} from "../../app/board-shortcuts";

export interface BoardShortcutActions {
  readonly gestureActive: boolean;
  readonly colorSampling: boolean;
  readonly commandPaletteOpen: boolean;
  readonly shortcutSettingsOpen: boolean;
  readonly focused: boolean;
  readonly pureRef: boolean;
  readonly hasSelection: boolean;
  readonly clipboardHasItems: boolean;
  readonly cancelGesture: () => void;
  readonly cancelSampling: () => void;
  readonly toggleCommandPalette: () => void;
  readonly closeShortcutSettings: () => void;
  readonly closeCommandPalette: () => void;
  readonly crop: () => void;
  readonly resetCrop: () => void;
  readonly flipX: () => void;
  readonly flipY: () => void;
  readonly toggleSelectionGrayscale: () => void;
  readonly toggleCanvasGrayscale: () => void;
  readonly toggleSampling: () => void;
  readonly toggleLock: () => void;
  readonly startFocusPlayback: () => void;
  readonly exitFocus: () => void;
  readonly fitAll: () => void;
  readonly zoom100: () => void;
  readonly selectAll: () => void;
  readonly toggleFocus: () => void;
  readonly stepFocus: (offset: -1 | 1) => void;
  readonly stepPureRefObject: (offset: -1 | 1) => void;
  readonly moveLayer: (up: boolean) => void;
  readonly nudge: (key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown", distance: number) => void;
  readonly fitSelection: () => void;
  readonly delete: () => void;
  readonly editComment: () => void;
  readonly parent: () => void;
  readonly unparent: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly duplicate: () => void;
  readonly copy: () => void;
  readonly paste: (preferBoardClipboard: boolean) => void;
  readonly group: () => void;
  readonly ungroup: () => void;
  readonly resetTransform: () => void;
  readonly toggleGrid: () => void;
}

export type BoardShortcutState = Readonly<Pick<
  BoardShortcutActions,
  | "gestureActive"
  | "colorSampling"
  | "commandPaletteOpen"
  | "shortcutSettingsOpen"
  | "focused"
  | "pureRef"
  | "hasSelection"
  | "clipboardHasItems"
>>;

export type BoardShortcutCommand = Exclude<keyof BoardShortcutActions, keyof BoardShortcutState>;
export type BoardShortcutPayload = string | number | boolean | undefined;

function editingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || Boolean(target?.isContentEditable);
}

/** Owns global board shortcut matching and precedence; actions remain ID-based commands. */
export function useBoardShortcuts(
  bindings: BoardShortcutBindings,
  state: BoardShortcutState,
  dispatch: (command: BoardShortcutCommand, payload?: BoardShortcutPayload) => void,
): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
      if (event.key === "Escape" && state.gestureActive) {
        event.preventDefault(); dispatch("cancelGesture"); return;
      }
      if (event.key === "Escape" && state.colorSampling) {
        event.preventDefault(); dispatch("cancelSampling"); return;
      }
      if (shortcutMatches(event, bindings.commandPalette)) {
        event.preventDefault(); dispatch("toggleCommandPalette"); return;
      }
      if (state.shortcutSettingsOpen) {
        if (event.key === "Escape") { event.preventDefault(); dispatch("closeShortcutSettings"); }
        return;
      }
      if (state.commandPaletteOpen) {
        if (event.key === "Escape") { event.preventDefault(); dispatch("closeCommandPalette"); }
        return;
      }
      const isEditing = editingTarget(event);
      const matchingShortcutId = !isEditing
        ? (Object.keys(bindings) as BoardShortcutId[]).find((id) => shortcutMatches(event, bindings[id]))
        : undefined;
      const key = event.key.toLowerCase();
      if (!isEditing && state.pureRef) {
        if (event.ctrlKey && event.altKey && event.shiftKey && key === "c") { event.preventDefault(); dispatch("crop"); return; }
        if (event.ctrlKey && event.shiftKey && !event.altKey && key === "c") { event.preventDefault(); dispatch("resetCrop"); return; }
        if (event.altKey && event.shiftKey && !event.ctrlKey && key === "h") { event.preventDefault(); dispatch("flipX"); return; }
        if (event.altKey && event.shiftKey && !event.ctrlKey && key === "v") { event.preventDefault(); dispatch("flipY"); return; }
        if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "g") { event.preventDefault(); dispatch("toggleSelectionGrayscale"); return; }
        if (event.ctrlKey && event.altKey && !event.shiftKey && key === "g") { event.preventDefault(); dispatch("toggleCanvasGrayscale"); return; }
        if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "t") { event.preventDefault(); dispatch("toggleSampling"); return; }
        if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "l") { event.preventDefault(); dispatch("toggleLock"); return; }
        if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "s") { event.preventDefault(); dispatch("startFocusPlayback"); return; }
        if (event.ctrlKey && event.shiftKey && !event.altKey && key === "z") { event.preventDefault(); dispatch("redo"); return; }
      }
      if (!isEditing && event.key === "Escape" && state.focused) { event.preventDefault(); dispatch("exitFocus"); return; }
      if (!isEditing && event.ctrlKey && !event.altKey && event.key === " ") { event.preventDefault(); dispatch("fitAll"); return; }
      if (!isEditing && event.ctrlKey && !event.altKey && event.key === "0") { event.preventDefault(); dispatch("zoom100"); return; }
      if (!isEditing && event.ctrlKey && !event.altKey && key === "a") { event.preventDefault(); dispatch("selectAll"); return; }
      if (!isEditing && shortcutMatches(event, bindings.focus)) { event.preventDefault(); dispatch("toggleFocus"); return; }
      if (!isEditing && state.focused && !matchingShortcutId && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault(); dispatch("stepFocus", event.key === "ArrowRight" ? 1 : -1); return;
      }
      if (!isEditing && state.pureRef && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault(); dispatch("stepPureRefObject", event.key === "ArrowRight" ? 1 : -1); return;
      }
      if (!isEditing && state.pureRef && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (!state.hasSelection) return;
        event.preventDefault(); dispatch("moveLayer", event.key === "ArrowUp"); return;
      }
      if (!isEditing && shortcutMatches(event, bindings.delete)) { event.preventDefault(); dispatch("delete"); return; }
      if (!isEditing && !matchingShortcutId && !state.pureRef && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        if (!state.hasSelection) return;
        event.preventDefault(); dispatch("nudge", `${event.key}:${event.shiftKey ? 10 : 1}`); return;
      }
      if (!isEditing && !matchingShortcutId && !event.ctrlKey && key === "f") { event.preventDefault(); dispatch(state.hasSelection ? "fitSelection" : "fitAll"); return; }
      if (!isEditing && shortcutMatches(event, bindings.comment)) { event.preventDefault(); dispatch("editComment"); return; }
      if (!isEditing && shortcutMatches(event, bindings.parent)) { event.preventDefault(); dispatch("parent"); return; }
      if (!isEditing && shortcutMatches(event, bindings.unparent)) { event.preventDefault(); dispatch("unparent"); return; }
      if (isEditing) return;
      if (shortcutMatches(event, bindings.undo)) dispatch("undo");
      else if (shortcutMatches(event, bindings.redo)) dispatch("redo");
      else if (shortcutMatches(event, bindings.duplicate)) dispatch("duplicate");
      else if (shortcutMatches(event, bindings.copy)) dispatch("copy");
      else if (shortcutMatches(event, bindings.paste)) dispatch("paste", state.clipboardHasItems);
      else if (shortcutMatches(event, bindings.group)) dispatch("group");
      else if (shortcutMatches(event, bindings.ungroup)) dispatch("ungroup");
      else if (shortcutMatches(event, bindings.resetTransform)) dispatch("resetTransform");
      else if (shortcutMatches(event, bindings.fitAll)) dispatch("fitAll");
      else if (shortcutMatches(event, bindings.fitSelection)) dispatch("fitSelection");
      else if (shortcutMatches(event, bindings.toggleGrid)) dispatch("toggleGrid");
      else return;
      event.preventDefault();
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
