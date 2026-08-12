import { ChevronRight, Layers } from "lucide-react";
import { useState } from "react";

export function FoundLayersPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className={`found-layers-panel${open ? " open" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="found-svg-layers"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={13} aria-hidden="true" />
        <Layers size={13} aria-hidden="true" />
        <span>Layers (0)</span>
      </button>
      {open && (
        <div id="found-svg-layers" className="found-layers-empty" role="status">
          No layers
        </div>
      )}
    </section>
  );
}
