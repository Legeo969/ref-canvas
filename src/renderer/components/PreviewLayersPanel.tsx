import { ChevronRight, Layers } from "lucide-react";
import { useState } from "react";

export function PreviewLayersPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className={`preview-layers-panel${open ? " open" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="preview-svg-layers"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={13} aria-hidden="true" />
        <Layers size={13} aria-hidden="true" />
        <span>Layers (0)</span>
      </button>
      {open && (
        <div id="preview-svg-layers" className="preview-layers-empty" role="status">
          No layers
        </div>
      )}
    </section>
  );
}
