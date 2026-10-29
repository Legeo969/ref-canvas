import { ImagePlus } from "lucide-react";
import { useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { translate } from "../app/i18n";
import { useAppStore } from "../app/store";
import { DIRECTORY_ENTRY_MIME } from "./DirectoryAssetPanel";
import { ReferenceMatchStudio } from "./ReferenceMatchStudio";

/**
 * 参考图仿色工具面板（工作区右侧那一栏）。
 *
 * 它和预览面板占同一个位置，但不是预览里的浮层：左侧仍然是侧栏与素材网格，
 * 点选素材即把它当源画面。源画面默认跟随当前选中项，也可以在这个面板里
 * 重新选一张或直接拖进来。
 */
export function MatchWorkspace() {
  const selectedEntry = useAppStore((state) => state.selectedDirectoryEntry);
  const rememberedSource = useAppStore((state) => state.matchSourcePath);
  const showMatchWorkspace = useAppStore((state) => state.showMatchWorkspace);
  const [dragOver, setDragOver] = useState(false);

  const selectedPath = selectedEntry && !selectedEntry.isDirectory ? selectedEntry.path : null;
  const sourcePath = selectedPath ?? rememberedSource;

  const acceptSource = (path: string) => showMatchWorkspace(path);

  const pickSource = async () => {
    const [filename] = await window.refCanvas.system.pickFile({
      title: translate("preview.matchPickSource"),
      multiSelections: false,
      filters: [
        {
          name: "Image",
          extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "avif", "dpx"],
        },
      ],
    });
    if (filename) acceptSource(filename);
  };

  const dropSource = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    const transfer = event.dataTransfer;
    const internal = transfer.getData(DIRECTORY_ENTRY_MIME);
    if (internal) {
      try {
        const payload = JSON.parse(internal) as { path?: string; isDirectory?: boolean };
        if (payload.path && !payload.isDirectory) {
          acceptSource(payload.path);
          return;
        }
      } catch {
        // 走外部文件分支。
      }
    }
    const files = Array.from(transfer.files);
    const [filename] = files.length ? window.refCanvas.library.pathsForFiles(files) : [];
    if (filename) acceptSource(filename);
  };

  return (
    <aside
      className={`match-tool-panel${dragOver ? " is-drag-over" : ""}`}
      aria-label={translate("workspace.match")}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={dropSource}
    >
      <header className="match-tool-header">
        <strong>{translate("workspace.match")}</strong>
        <button type="button" className="match-secondary" onClick={() => void pickSource()}>
          <ImagePlus size={12} aria-hidden="true" />
          {translate("preview.matchPickSource")}
        </button>
      </header>
      <div className="match-tool-body">
        {sourcePath ? (
          <ReferenceMatchStudio
            key={sourcePath}
            sourcePath={sourcePath}
            onChangeSource={() => void pickSource()}
          />
        ) : (
          <div className="match-tool-empty">
            <span>{translate("preview.matchNoSource")}</span>
            <span className="match-tool-empty-hint">{translate("preview.matchSourceHint")}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
