import { useState } from "react";
import type { PreviewSettings } from "../../shared/contracts";
import { translate } from "../app/i18n";

interface PreviewColorToolsProps {
  settings: PreviewSettings;
}

export function PreviewColorTools({ settings }: PreviewColorToolsProps) {
  const [activeLut, setActiveLut] = useState(settings.activeLut);

  const updateLut = async (value: string | null) => {
    const next = await window.refCanvas.system.setPreferences({ previewSettings: { activeLut: value } });
    setActiveLut(next.previewSettings.activeLut);
  };

  const importLut = async () => {
    const [filename] = await window.refCanvas.system.pickFile({
      title: translate("preview.importLut"),
      multiSelections: false,
      filters: [{ name: "LUT", extensions: ["cube", "3dl"] }],
    });
    if (filename) await updateLut(filename);
  };

  return (
    <section className="preview-color-tools lut-popover-menu" aria-label={translate("preview.lutMenu")}>
      <button type="button" className={!activeLut ? "active" : ""} aria-label={translate("preview.noLut")} onClick={() => void updateLut(null)}>
        <span className="lut-radio" aria-hidden="true" />
        {translate("preview.none")}
      </button>
      {activeLut && <button type="button" className="active current-lut" title={activeLut} onClick={() => undefined}>
        <span className="lut-radio" aria-hidden="true" />
        {activeLut.split(/[\\/]/).pop()}
      </button>}
      <button type="button" aria-label={translate("preview.importLut")} onClick={() => void importLut()}>{translate("preview.addLut")}</button>
    </section>
  );
}
