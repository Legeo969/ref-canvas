import { useState } from "react";
import type { PreviewSettings } from "../../shared/contracts";
import { translate } from "../app/i18n";

interface PreviewColorToolsProps {
  settings: PreviewSettings;
  /** 打开「参考图仿色」；缺省时不显示入口（例如非图片/视频素材）。 */
  onOpenMatch?: () => void;
}

export function PreviewColorTools({ settings, onOpenMatch }: PreviewColorToolsProps) {
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
      {activeLut && <span className="active current-lut" title={activeLut}>
        <span className="lut-radio" aria-hidden="true" />
        {activeLut.split(/[\\/]/).pop()}
      </span>}
      <button type="button" aria-label={translate("preview.importLut")} onClick={() => void importLut()}>{translate("preview.addLut")}</button>
      {onOpenMatch && (
        <button type="button" className="lut-match-entry" onClick={onOpenMatch}>
          {translate("preview.matchOpen")}
        </button>
      )}
    </section>
  );
}
