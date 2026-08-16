import { Check, Clock3, Film, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { MediaNote } from "../../shared/contracts";
import { translate } from "../app/i18n";

type CurrentPosition = { kind: "time" | "frame"; value: number } | null;

interface AssetNotesPanelProps {
  assetId: string;
  position?: CurrentPosition;
  onSeekTime?: (milliseconds: number) => void;
  onSeekFrame?: (frame: number) => void;
}

function positionLabel(note: MediaNote): string {
  if (note.positionKind === "frame") return translate("notes.framePosition").replace("{frame}", String(note.position));
  if (note.positionKind === "time") {
    const seconds = Math.floor(note.position / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return translate("notes.asset");
}

export function AssetNotesPanel({ assetId, position = null, onSeekTime, onSeekFrame }: AssetNotesPanelProps) {
  const [notes, setNotes] = useState<MediaNote[]>([]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.refCanvas.mediaNotes.list(assetId).then((next) => {
      if (!cancelled) setNotes(next);
    });
    return () => { cancelled = true; };
  }, [assetId]);

  const save = async (linked: boolean) => {
    const text = draft.trim();
    if (!text) return;
    if (editingId) {
      const updated = await window.refCanvas.mediaNotes.update(editingId, { text });
      setNotes((current) => current.map((note) => note.id === editingId ? updated : note));
      setEditingId(null);
    } else {
      const target = linked && position
        ? { positionKind: position.kind, position: position.value }
        : { positionKind: "general" as const, position: 0 };
      const created = await window.refCanvas.mediaNotes.create(assetId, { ...target, text });
      setNotes((current) => [...current, created]);
    }
    setDraft("");
  };

  return (
    <section className="asset-notes-panel" aria-label={translate("notes.panel")}>
      <div className="asset-notes-compose">
        <input aria-label={translate("notes.draft")} value={draft} maxLength={2000} placeholder={translate("notes.addAssetNote")} onChange={(event) => setDraft(event.target.value)} />
        <button type="button" aria-label={translate("notes.addAssetNote")} title={translate("notes.addAssetNote")} onClick={() => void save(false)}><Plus size={14} /></button>
        {position && <button type="button" aria-label={position.kind === "frame" ? translate("notes.addAtFrame") : translate("notes.addAtTime")} title={translate("notes.addLinked")} onClick={() => void save(true)}>
          {position.kind === "frame" ? <Film size={14} /> : <Clock3 size={14} />}
        </button>}
      </div>
      <div className="asset-notes-list">
        {notes.map((note) => (
          <article key={note.id} className="asset-note-row">
            <button type="button" className="asset-note-position" aria-label={note.positionKind === "frame" ? translate("notes.jumpToFrame").replace("{frame}", String(note.position)) : note.positionKind === "time" ? translate("notes.jumpTo").replace("{position}", positionLabel(note)) : translate("preview.notes")} onClick={() => {
              if (note.positionKind === "frame") onSeekFrame?.(note.position);
              if (note.positionKind === "time") onSeekTime?.(note.position);
            }}>{positionLabel(note)}</button>
            {editingId === note.id ? <input aria-label={translate("notes.edit")} value={draft} onChange={(event) => setDraft(event.target.value)} /> : <span>{note.text}</span>}
            <button type="button" aria-label={editingId === note.id ? translate("notes.saveNote") : translate("notes.edit")} onClick={() => {
              if (editingId === note.id) void save(false);
              else { setEditingId(note.id); setDraft(note.text); }
            }}>{editingId === note.id ? <Check size={13} /> : <Pencil size={13} />}</button>
            <button type="button" aria-label={translate("preview.notesDelete")} onClick={() => {
              void window.refCanvas.mediaNotes.delete(note.id);
              setNotes((current) => current.filter((item) => item.id !== note.id));
            }}><Trash2 size={13} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}
