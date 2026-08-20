import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface PreviewTransportSnapshot {
  kind: "gif" | "video" | "sequence";
  playing: boolean;
  position: number;
  durationSeconds: number;
  frameIndex: number;
  frameCount: number;
  fps: number | null;
  playbackRate: number;
  looping: boolean;
  muted: boolean;
  volume: number;
}

export interface PreviewTransportActions {
  togglePlaying(): void;
  seek(position: number): void;
  stepFrames(delta: number): void;
  setLooping(value: boolean): void;
  setPlaybackRate(value: number): void;
  setMuted(value: boolean): void;
  setVolume(value: number): void;
  /** 长按扫览：开始连续前进/后退（direction 1=前进，-1=后退）。 */
  startScrub?(direction: 1 | -1): void;
  /** 长按扫览：结束并可选定格到最终精确帧。 */
  stopScrub?(finalize: boolean): void;
  exportGif?(): void;
}

interface PreviewTransportState {
  snapshot: PreviewTransportSnapshot | null;
  actions: PreviewTransportActions | null;
}

interface PreviewTransportRegistry {
  register(id: symbol, snapshot: PreviewTransportSnapshot, actions: PreviewTransportActions): void;
  unregister(id: symbol): void;
}

export function previewTransportSnapshotKey(snapshot: PreviewTransportSnapshot): string {
  return [
    snapshot.kind,
    snapshot.playing,
    String(snapshot.position),
    String(snapshot.durationSeconds),
    snapshot.frameIndex,
    snapshot.frameCount,
    String(snapshot.fps),
    String(snapshot.playbackRate),
    snapshot.looping,
    snapshot.muted,
    String(snapshot.volume),
  ].join("|");
}

const PreviewTransportStateContext = createContext<PreviewTransportState | null>(null);
const PreviewTransportRegistryContext = createContext<PreviewTransportRegistry | null>(null);

const emptyState: PreviewTransportState = { snapshot: null, actions: null };
const emptyRegistry: PreviewTransportRegistry = {
  register: () => undefined,
  unregister: () => undefined,
};

export function PreviewTransportProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<{
    id: symbol;
    snapshot: PreviewTransportSnapshot;
    actions: PreviewTransportActions;
  } | null>(null);
  // 幂等注册：相同 id + 相同快照不重复 push，避免拖动/播放时高频 re-render
  // 把面板/滑块拖进「Maximum update depth exceeded」的循环。
  const lastRegistrationRef = useRef<{ id: symbol; key: string } | null>(null);

  const register = useCallback((
    id: symbol,
    snapshot: PreviewTransportSnapshot,
    actions: PreviewTransportActions,
  ) => {
    const key = previewTransportSnapshotKey(snapshot);
    const last = lastRegistrationRef.current;
    if (last && last.id === id && last.key === key) return;
    lastRegistrationRef.current = { id, key };
    setRegistration({ id, snapshot, actions });
  }, []);
  const unregister = useCallback((id: symbol) => {
    setRegistration((current) => current?.id === id ? null : current);
    if (lastRegistrationRef.current?.id === id) {
      lastRegistrationRef.current = null;
    }
  }, []);

  const registry = useMemo<PreviewTransportRegistry>(() => ({ register, unregister }), [register, unregister]);
  const state = useMemo<PreviewTransportState>(() => ({
    snapshot: registration?.snapshot ?? null,
    actions: registration?.actions ?? null,
  }), [registration]);

  return (
    <PreviewTransportRegistryContext.Provider value={registry}>
      <PreviewTransportStateContext.Provider value={state}>
        {children}
      </PreviewTransportStateContext.Provider>
    </PreviewTransportRegistryContext.Provider>
  );
}

export function usePreviewTransport(): PreviewTransportState {
  return useContext(PreviewTransportStateContext) ?? emptyState;
}

export function usePreviewTransportRegistration(
  snapshot: PreviewTransportSnapshot,
  actions: PreviewTransportActions,
) {
  const registry = useContext(PreviewTransportRegistryContext) ?? emptyRegistry;
  const register = registry.register;
  const unregister = registry.unregister;
  const idRef = useRef<symbol | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const stableActionsRef = useRef<PreviewTransportActions | null>(null);
  if (idRef.current === null) idRef.current = Symbol("preview-transport");
  if (stableActionsRef.current === null) {
    stableActionsRef.current = {
      togglePlaying: () => actionsRef.current.togglePlaying(),
      seek: (position) => actionsRef.current.seek(position),
      stepFrames: (delta) => actionsRef.current.stepFrames(delta),
      setLooping: (value) => actionsRef.current.setLooping(value),
      setPlaybackRate: (value) => actionsRef.current.setPlaybackRate(value),
      setMuted: (value) => actionsRef.current.setMuted(value),
      setVolume: (value) => actionsRef.current.setVolume(value),
      startScrub: (direction) => actionsRef.current.startScrub?.(direction),
      stopScrub: (finalize) => actionsRef.current.stopScrub?.(finalize),
      exportGif: () => actionsRef.current.exportGif?.(),
    };
  }
  const snapshotKey = previewTransportSnapshotKey(snapshot);
  // 快照变化只 push，不 unregister（避免把 provider 闪成 null 再重建，
  // 拖动时产生双倍 re-render 与滑块回跳）；卸载/换 id 才 unregister。
  useEffect(() => {
    if (!register) return;
    const id = idRef.current!;
    register(id, snapshot, stableActionsRef.current!);
  // Track the snapshot fields rather than requiring caller object stability.
  }, [register, snapshotKey]);
  useEffect(() => {
    if (!unregister) return;
    const id = idRef.current!;
    return () => unregister(id);
  }, [unregister]);
}
