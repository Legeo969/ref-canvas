import { useEffect, useEffectEvent } from "react";

const CONTINUOUS_KEYS = new Set(["z", "c", "v", "s", "d"]);

export interface BoardGestureKeyBindings {
  readonly interactionPreset: string;
  readonly onPress: (key: string) => void;
  readonly onRelease: (key: string) => void;
  readonly onBlur: () => void;
}

/** Owns the global key lifecycle for PureRef's continuous pointer gestures. */
export function useBoardGestureKeys(bindings: BoardGestureKeyBindings): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (
        bindings.interactionPreset === "pureref" &&
        !event.ctrlKey &&
        !event.altKey &&
        CONTINUOUS_KEYS.has(key)
      ) {
        bindings.onPress(key);
      }
  });
  const onKeyUp = useEffectEvent((event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (CONTINUOUS_KEYS.has(key)) bindings.onRelease(key);
  });
  const onBlur = useEffectEvent(() => bindings.onBlur());
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
