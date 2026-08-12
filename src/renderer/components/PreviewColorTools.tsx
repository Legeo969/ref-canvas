import { FilePlus2, RotateCcw } from "lucide-react";
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
    <section className="preview-color-tools" aria-label="LUT 与色彩管理">
      <div className="preview-color-builtins">
        <strong>内置显示变换</strong>
        <span>ACES</span><span>Reinhard</span><span>Neutral</span>
      </div>
      <div className="preview-color-lut-row">
        <span className="preview-color-lut-path" title={activeLut ?? ""}>{activeLut ?? "未选择外部 LUT"}</span>
        <button type="button" aria-label="导入 LUT" title="导入 .cube 或 .3dl" onClick={() => void importLut()}><FilePlus2 size={15} /></button>
        <button type="button" aria-label="清除 LUT" title="清除 LUT" disabled={!activeLut} onClick={() => void updateLut(null)}><RotateCcw size={15} /></button>
      </div>
      <small>LUT 只影响预览与导出显示转换，不修改源文件。</small>
    </section>
  );
}
