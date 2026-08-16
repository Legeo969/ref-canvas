import {
  Crosshair,
  MessageSquarePlus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  AssetAnnotation,
  AssetRecord,
} from "../../shared/contracts";
import { translate } from "../app/i18n";
import { useDialog } from "./DialogProvider";

interface AssetAnnotationDialogProps {
  asset: AssetRecord;
  onClose(): void;
}

export function AssetAnnotationDialog({
  asset,
  onClose,
}: AssetAnnotationDialogProps) {
  const dialog = useDialog();
  const panelRef = useRef<HTMLElement>(null);
  const [annotations, setAnnotations] = useState<AssetAnnotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    void window.refCanvas.library
      .listAnnotations(asset.id)
      .then((items) => {
        if (current) setAnnotations(items);
      })
      .catch(() => {
        if (current) setError(translate("annotations.loadFailed"));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    const frame = window.requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus(),
    );
    return () => {
      current = false;
      window.cancelAnimationFrame(frame);
    };
  }, [asset.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (adding || movingId) {
        setAdding(false);
        setMovingId(null);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adding, movingId, onClose]);

  const savePosition = async (
    event: ReactMouseEvent<HTMLImageElement>,
  ) => {
    if (!adding && !movingId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width),
    );
    const y = Math.min(
      1,
      Math.max(0, (event.clientY - bounds.top) / bounds.height),
    );
    setError("");

    if (movingId) {
      try {
        const updated = await window.refCanvas.library.updateAnnotation(
          movingId,
          { x, y },
        );
        setAnnotations((items) =>
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
        setSelectedId(updated.id);
        setMovingId(null);
      } catch {
        setError(translate("annotations.moveFailed"));
      }
      return;
    }

    setAdding(false);
    await dialog.requestForm({
      title: translate("annotations.addTitle"),
      description: translate("annotations.addDescription"),
      confirmLabel: translate("annotations.add"),
      fields: [
        {
          name: "text",
          label: translate("annotations.contentLabel"),
          type: "textarea",
          rows: 5,
          required: true,
          maxLength: 2_000,
          placeholder: translate("annotations.contentPlaceholder"),
        },
      ],
      onSubmit: async ({ text }) => {
        const created = await window.refCanvas.library.createAnnotation(
          asset.id,
          { x, y, text },
        );
        setAnnotations((items) => [...items, created]);
        setSelectedId(created.id);
      },
    });
  };

  const editAnnotation = async (annotation: AssetAnnotation) => {
    await dialog.requestForm({
      title: translate("annotations.editTitle"),
      confirmLabel: translate("collections.save"),
      fields: [
        {
          name: "text",
          label: translate("annotations.contentLabel"),
          type: "textarea",
          rows: 5,
          initialValue: annotation.text,
          required: true,
          maxLength: 2_000,
        },
      ],
      onSubmit: async ({ text }) => {
        const updated = await window.refCanvas.library.updateAnnotation(
          annotation.id,
          { text },
        );
        setAnnotations((items) =>
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
      },
    });
  };

  const deleteAnnotation = async (annotation: AssetAnnotation) => {
    setError("");
    try {
      await window.refCanvas.library.deleteAnnotation(annotation.id);
      setAnnotations((items) =>
        items.filter((item) => item.id !== annotation.id),
      );
      setSelectedId((id) => (id === annotation.id ? null : id));
      setMovingId((id) => (id === annotation.id ? null : id));
    } catch {
      setError(translate("annotations.deleteFailed"));
    }
  };

  const interactionLabel = adding
    ? translate("annotations.placeHint")
    : movingId
      ? translate("annotations.moveHint")
      : "";

  return (
    <div className="annotation-backdrop" onMouseDown={onClose}>
      <section
        ref={panelRef}
        className="annotation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="annotation-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">{translate("annotations.eyebrow")}</span>
            <h2 id="annotation-dialog-title">{asset.title}</h2>
          </div>
          <div className="annotation-header-actions">
            <button
              className={adding ? "active" : ""}
              type="button"
              onClick={() => {
                setMovingId(null);
                setAdding((value) => !value);
              }}
            >
              <MessageSquarePlus size={16} />
              {adding ? translate("annotations.cancelAdd") : translate("annotations.add")}
            </button>
            <button
              data-autofocus
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label={translate("annotations.close")}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div
          className={`annotation-stage ${
            adding || movingId ? "placing" : ""
          }`}
        >
          <div className="annotation-image-wrap">
            <img
              src={asset.previewUrl}
              alt={asset.title}
              onClick={(event) => void savePosition(event)}
              draggable={false}
            />
            {annotations.map((annotation, index) => (
              <button
                className={`annotation-pin ${
                  selectedId === annotation.id ? "selected" : ""
                }`}
                key={annotation.id}
                type="button"
                style={{
                  left: `${annotation.x * 100}%`,
                  top: `${annotation.y * 100}%`,
                }}
                aria-label={translate("annotations.viewNamed").replace("{index}", String(index + 1))}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(annotation.id);
                }}
              >
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
          {interactionLabel && (
            <div className="annotation-placement-hint">
              <Crosshair size={15} />
              {interactionLabel}
              <kbd>Esc</kbd>
            </div>
          )}
        </div>

        <aside className="annotation-comments">
          <header>
            <div>
              <strong>{translate("annotations.spaceComments")}</strong>
              <span>{translate("annotations.count").replace("{count}", String(annotations.length))}</span>
            </div>
            <p>{translate("annotations.navigateHint")}</p>
          </header>
          {error && <div className="annotation-error">{error}</div>}
          <div className="annotation-comment-list">
            {loading && <div className="annotation-empty">{translate("annotations.loading")}</div>}
            {!loading && annotations.length === 0 && (
              <div className="annotation-empty">
                <MessageSquarePlus size={22} />
                <strong>{translate("annotations.emptyTitle")}</strong>
                <span>{translate("annotations.emptyHint")}</span>
              </div>
            )}
            {annotations.map((annotation, index) => (
              <article
                className={selectedId === annotation.id ? "selected" : ""}
                key={annotation.id}
                onClick={() => setSelectedId(annotation.id)}
              >
                <span className="annotation-index">{index + 1}</span>
                <p>{annotation.text}</p>
                <div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAdding(false);
                      setMovingId(annotation.id);
                      setSelectedId(annotation.id);
                    }}
                    aria-label={translate("annotations.relocateNamed").replace("{index}", String(index + 1))}
                  >
                    <Crosshair size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void editAnnotation(annotation);
                    }}
                    aria-label={translate("annotations.editNamed").replace("{index}", String(index + 1))}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteAnnotation(annotation);
                    }}
                    aria-label={translate("annotations.deleteNamed").replace("{index}", String(index + 1))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
