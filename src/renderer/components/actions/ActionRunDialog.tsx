import { FolderOpen, Play, Save, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ActionPreset,
  ActionPresetInput,
  AssetActionPreview,
  AssetActionRequest,
} from "../../../shared/contracts";
import { formatBytes } from "../../app/format-bytes";
import { SelectMenu } from "../SelectMenu";

const BUILT_INS: Array<ActionPresetInput & {
  id: string;
}> = [
  { id: "webp", name: "转为 WebP", type: "webp", options: { format: "webp", quality: 82 } },
  { id: "compress", name: "压缩图片", type: "compress", options: { quality: 82 } },
  { id: "export-folder", name: "导出到文件夹", type: "export-folder", options: {} },
  { id: "export-csv", name: "导出 CSV", type: "export-csv", options: { fields: ["title", "path", "size", "tags"] } },
];

export function ActionRunDialog({ paths, onClose }: { paths: string[]; onClose(): void }) {
  const [presets, setPresets] = useState<ActionPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("webp");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [namingTemplate, setNamingTemplate] = useState("{name}");
  const [presetName, setPresetName] = useState("");
  const [preview, setPreview] = useState<AssetActionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([
      window.refCanvas.actions.listPresets(),
      Promise.all(paths.map((path) => window.refCanvas.filesystem.materialize(path))),
    ]).then(([nextPresets, assets]) => {
      setPresets(nextPresets);
      setAssetIds(assets.map((result) => result.asset.id));
      setLoading(false);
    }).catch((reason) => {
      setError(String(reason));
      setLoading(false);
    });
  }, [paths]);

  const definition = useMemo(
    () => presets.find((preset) => preset.id === selectedPreset)
      ?? BUILT_INS.find((preset) => preset.id === selectedPreset)
      ?? BUILT_INS[0],
    [presets, selectedPreset],
  );
  const presetOptions = useMemo(
    () => [
      ...BUILT_INS.map((preset) => ({ value: preset.id, label: preset.name })),
      ...presets.map((preset) => ({ value: preset.id, label: `我的模板 · ${preset.name}` })),
    ],
    [presets],
  );
  const request: AssetActionRequest = {
    type: definition.type,
    options: definition.options,
    targets: { mode: "ids", ids: assetIds },
    outputDirectory: outputDirectory || definition.outputDirectory || null,
    namingTemplate: namingTemplate || definition.namingTemplate || "{name}",
    keepHierarchy: "keepHierarchy" in definition ? definition.keepHierarchy : false,
    writeSidecar: "writeSidecar" in definition ? definition.writeSidecar : false,
  };

  const refreshPreview = async () => {
    setError("");
    setPreview(await window.refCanvas.actions.preview(request));
  };

  const run = async () => {
    if (!preview) return;
    try {
      await window.refCanvas.actions.start(request);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    const saved = await window.refCanvas.actions.savePreset({
      name,
      type: request.type,
      options: request.options,
      outputDirectory: request.outputDirectory,
      namingTemplate: request.namingTemplate,
      keepHierarchy: request.keepHierarchy,
      writeSidecar: request.writeSidecar,
    });
    setPresets((current) => [...current, saved]);
    setSelectedPreset(saved.id);
    setPresetName("");
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal-panel action-run-dialog" role="dialog" aria-modal="true" aria-label="批处理预览" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><WandSparkles size={18} /><div><h2>批处理</h2><p>{paths.length} 个输入素材</p></div></div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="action-run-content">
          <label>动作模板
            <SelectMenu
              value={selectedPreset}
              options={presetOptions}
              ariaLabel="动作模板"
              onValueChange={(value) => { setSelectedPreset(value); setPreview(null); }}
            />
          </label>
          <label>输出目录
            <div className="action-output-row"><input value={outputDirectory} readOnly placeholder="使用 RefCanvas 默认输出目录" /><button className="icon-button" aria-label="选择输出目录" onClick={async () => { const directory = await window.refCanvas.system.pickDirectory({ title: "选择批处理输出目录" }); if (directory) { setOutputDirectory(directory); setPreview(null); } }}><FolderOpen size={15} /></button></div>
          </label>
          <label>命名规则<input value={namingTemplate} onChange={(event) => { setNamingTemplate(event.target.value); setPreview(null); }} /></label>

          {preview && <div className="action-preview-summary" aria-live="polite">
            <span><strong>{preview.inputCount}</strong> 个输入</span>
            <span><strong>{formatBytes(preview.inputBytes, "-")}</strong> 读取量</span>
            <span><strong>{formatBytes(preview.estimatedOutputBytes, "-")}</strong> 预计磁盘变化</span>
            <span title={preview.outputDirectory}>输出到 {preview.outputDirectory}</span>
            <span><strong>{preview.conflicts.length}</strong> 个预计覆盖项</span>
            {preview.conflicts.slice(0, 3).map((filename) => (
              <span className="action-preview-conflict" key={filename}>{filename}</span>
            ))}
          </div>}
          {error && <p className="settings-error" role="alert">{error}</p>}
        </div>
        <footer className="action-run-footer">
          <input aria-label="模板名称" placeholder="模板名称" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
          <button className="secondary-button" onClick={() => void savePreset()} disabled={loading || !presetName.trim()}><Save size={15} /> 保存模板</button>
          <span />
          <button className="secondary-button" onClick={() => void refreshPreview()} disabled={loading || assetIds.length === 0}>预览</button>
          <button className="primary-button" onClick={() => void run()} disabled={!preview}><Play size={15} /> 开始执行</button>
        </footer>
      </section>
    </div>
  );
}
