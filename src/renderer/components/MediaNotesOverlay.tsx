import { NotebookPen, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AssetRecord, MediaNote } from "../../shared/contracts";

interface MediaNotesOverlayProps {
  asset: Pick<AssetRecord, "id">;
  children: ReactNode;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/**
 * Wraps a native <video>/<audio> element with time-point notes and persistent
 * playback state (rate, mute, volume, position). Notes are stored locally and
 * included in the local notes search.
 */
export function MediaNotesOverlay({
  asset,
  children,
}: MediaNotesOverlayProps) {
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const [notes, setNotes] = useState<MediaNote[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftTime, setDraftTime] = useState(0);
  const [adding, setAdding] = useState(false);

  /** 包裹层内的原生 <video>/<audio>（子元素由各 Provider 提供）。 */
  const mediaElement = (): HTMLMediaElement | null => {
    const host = mediaRef.current;
    if (!host) return null;
    return host.querySelector<HTMLMediaElement>("video,audio");
  };

  useEffect(() => {
    let cancelled = false;
    void window.refCanvas.mediaNotes.list(asset.id).then((list) => {
      if (!cancelled) setNotes(list);
    });
    void window.refCanvas.mediaNotes.getPlaybackState(asset.id).then((state) => {
      const media = mediaElement();
      if (!media || !state || cancelled) return;
      media.playbackRate = state.playbackRate;
      media.muted = state.muted;
      media.volume = state.volume;
    });
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  const persist = () => {
    const current = mediaElement();
    if (!current) return;
    void window.refCanvas.mediaNotes.setPlaybackState(asset.id, {
      playbackRate: current.playbackRate,
      muted: current.muted,
      volume: current.volume,
      positionMs: Math.round(current.currentTime * 1000),
    });
  };

  const addNote = async () => {
    const text = draft.trim();
    if (!text) return;
    const note = await window.refCanvas.mediaNotes.create(asset.id, {
      timeMs: draftTime,
      text,
    });
    setNotes((current) => [...current, note]);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="media-notes-root">
      <div
        ref={mediaRef}
        className="media-notes-media"
        onPlayCapture={persist}
        onPauseCapture={persist}
        onTimeUpdateCapture={persist}
        onRateChangeCapture={persist}
        onVolumeChangeCapture={persist}
      >
        {children}
        <div className="media-notes-floating">
          {notes.length > 0 && (
            <span className="media-note-marker">{notes.length}</span>
          )}
          <button
            className="media-note-toggle"
            aria-label={open ? "收起时间点备注" : "时间点备注"}
            onClick={() => setOpen((value) => !value)}
          >
            <NotebookPen size={14} />
          </button>
        </div>
      </div>
      {open && (
        <div className="media-notes-overlay">
          <div className="media-notes-header">
            <span>时间点备注</span>
            <button aria-label="关闭" onClick={() => setOpen(false)}>
              <X size={13} />
            </button>
          </div>
          <div className="media-notes-list">
            {notes.length === 0 && (
              <p className="media-notes-empty">还没有备注，播放时添加。</p>
            )}
            {notes.map((note) => (
              <div className="media-note-row" key={note.id}>
                <button
                  className="media-note-time"
                  title="跳到该时间点"
                  onClick={() => {
                    const current = mediaElement();
                    if (current) current.currentTime = note.timeMs / 1000;
                  }}
                >
                  {formatTime(note.timeMs)}
                </button>
                <span>{note.text}</span>
                <button
                  className="media-note-delete"
                  aria-label="删除备注"
                  onClick={() => {
                    void window.refCanvas.mediaNotes.delete(note.id);
                    setNotes((current) =>
                      current.filter((item) => item.id !== note.id),
                    );
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          {adding ? (
            <div className="media-notes-add">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={`备注（时间 ${formatTime(draftTime)}）`}
                maxLength={2000}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addNote();
                }}
              />
              <button onClick={() => void addNote()}>保存</button>
            </div>
          ) : (
            <button
              className="media-note-add-button"
              onClick={() => {
                const current = mediaElement();
                const timeMs = current
                  ? Math.round(current.currentTime * 1000)
                  : 0;
                setDraftTime(timeMs);
                setAdding(true);
              }}
            >
              <Plus size={13} />
              在此时间添加备注
            </button>
          )}
        </div>
      )}
    </div>
  );
}
