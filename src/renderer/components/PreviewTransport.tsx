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
  exportGif?(): void;
}

interface PreviewTransportValue {
  snapshot: PreviewTransportSnapshot | null;
  actions: PreviewTransportActions | null;
  register(id: symbol, snapshot: PreviewTransportSnapshot, actions: PreviewTransportActions): void;
  unregister(id: symbol): void;
}

const PreviewTransportContext = createContext<PreviewTransportValue | null>(null);

const emptyTransport: PreviewTransportValue = {
  snapshot: null,
  actions: null,
  register: () => undefined,
  unregister: () => undefined,
};

export function PreviewTransportProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<{
    id: symbol;
    snapshot: PreviewTransportSnapshot;
    actions: PreviewTransportActions;
  } | null>(null);

  const register = useCallback((
    id: symbol,
    snapshot: PreviewTransportSnapshot,
    actions: PreviewTransportActions,
  ) => setRegistration({ id, snapshot, actions }), []);
  const unregister = useCallback((id: symbol) => {
    setRegistration((current) => current?.id === id ? null : current);
  }, []);
  const value = useMemo<PreviewTransportValue>(() => ({
    snapshot: registration?.snapshot ?? null,
    actions: registration?.actions ?? null,
    register,
    unregister,
  }), [register, registration, unregister]);

  return (
    <PreviewTransportContext.Provider value={value}>
      {children}
    </PreviewTransportContext.Provider>
  );
}

export function usePreviewTransport(): PreviewTransportValue {
  return useContext(PreviewTransportContext) ?? emptyTransport;
}

export function usePreviewTransportRegistration(
  snapshot: PreviewTransportSnapshot,
  actions: PreviewTransportActions,
) {
  const context = useContext(PreviewTransportContext);
  const register = context?.register;
  const unregister = context?.unregister;
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
      exportGif: () => actionsRef.current.exportGif?.(),
    };
  }
  const snapshotKey = [
    snapshot.kind,
    snapshot.playing,
    snapshot.position,
    snapshot.durationSeconds,
    snapshot.frameIndex,
    snapshot.frameCount,
    snapshot.fps,
    snapshot.playbackRate,
    snapshot.looping,
    snapshot.muted,
    snapshot.volume,
  ].join("|");
  useEffect(() => {
    if (!register || !unregister) return;
    const id = idRef.current!;
    register(id, snapshot, stableActionsRef.current!);
    return () => unregister(id);
  // Track the snapshot fields rather than requiring caller object stability.
  }, [register, snapshotKey, unregister]);
}
