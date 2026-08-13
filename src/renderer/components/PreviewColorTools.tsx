import { useState } from "react";
import type { FoundSettings } from "../../shared/contracts";

interface PreviewColorToolsProps {
  settings: FoundSettings;
}

export function PreviewColorTools({ settings }: PreviewColorToolsProps) {
  const [activeLut, setActiveLut] = useState(settings.activeLut);

  const updateLut = async (value: string | null) => {
    const next = await window.refCanvas.system.setPreferences({ foundSettings: { activeLut: value } });
    setActiveLut(next.foundSettings.activeLut);
  };

  const importLut = async () => {
    const [filename] = await window.refCanvas.system.pickFile({
      title: "导入 LUT",
      multiSelections: false,
      filters: [{ name: "LUT", extensions: ["cube", "3dl"] }],
    });
    if (filename) await updateLut(filename);
  };

  return (
    <section className="preview-color-tools lut-popover-menu" aria-label="LUT 菜单">
      <button type="button" className={!activeLut ? "active" : ""} aria-label="无 LUT" onClick={() => void updateLut(null)}>
        <span className="lut-radio" aria-hidden="true" />
        无
      </button>
      {activeLut && <button type="button" className="active current-lut" title={activeLut} onClick={() => undefined}>
        <span className="lut-radio" aria-hidden="true" />
        {activeLut.split(/[\\/]/).pop()}
      </button>}
      <button type="button" aria-label="导入 LUT" onClick={() => void importLut()}>添加 LUT…</button>
    </section>
  );
}
