import { useAppStore } from "../app/store";
import { translate } from "../app/i18n";

/**
 * 后台建索引任务进度条（目录浏览模式共用）。
 * 目录模式由 DirectoryAssetPanel 单独渲染——AssetPanel 在目录模式下
 * 提前 return，原进度条不会出现。
 */
export function ImportProgressBar() {
  const store = useAppStore();
  if (!store.importJob || !store.importing) return null;
  return (
    <div className="import-progress">
      <div>
        <span>{translate("import.indexing")}</span>
        <span>
          {store.importJob.processed} / {store.importJob.discovered}
        </span>
      </div>
      <progress
        max={Math.max(1, store.importJob.discovered)}
        value={store.importJob.processed}
      />
      <button onClick={() => void store.cancelImport()}>{translate("dialogs.cancel")}</button>
    </div>
  );
}
