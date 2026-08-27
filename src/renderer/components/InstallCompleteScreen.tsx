import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { translate } from "../app/i18n";

const markUrl = new URL("../../../assets/app/refcanvas.png", import.meta.url).href;

interface InstallCompleteScreenProps {
  onOpen(): void;
}

export function InstallCompleteScreen({ onOpen }: InstallCompleteScreenProps) {
  const openButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    openButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);

  return (
    <div className="install-complete-backdrop" role="presentation">
      <section
        className="install-complete-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-complete-title"
      >
        <div className="install-complete-art" aria-hidden="true">
          <img src={markUrl} alt="" />
          <span className="install-complete-check"><CheckCircle2 size={22} /></span>
        </div>
        <p className="install-complete-eyebrow">{translate("app.installComplete.eyebrow")}</p>
        <h1 id="install-complete-title">{translate("app.installComplete.title")}</h1>
        <p className="install-complete-description">{translate("app.installComplete.description")}</p>
        <button ref={openButtonRef} className="primary-button install-complete-action" onClick={onOpen}>
          {translate("app.installComplete.open")}
          <ArrowRight size={16} />
        </button>
        <p className="install-complete-footnote">{translate("app.installComplete.footnote")}</p>
      </section>
    </div>
  );
}
