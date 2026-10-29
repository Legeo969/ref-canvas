import { ImagePlus } from "lucide-react";
import { useEffect, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { translate } from "../app/i18n";
import { useAppStore } from "../app/store";
import { DIRECTORY_ENTRY_MIME } from "./DirectoryAssetPanel";
import { ReferenceMatchStudio } from "./ReferenceMatchStudio";

/**
 * 参考图仿色工具面板（工作区右侧那一栏）。
 *
 * 它是常驻的工作区，不是一次性的对话框：参考图、观感参数、上次拟合结果都留在
 * 面板里，网格里点另一张素材只是换「源画面」。所以这里刻意不用 key 重挂组件，
 * 并且记住上一张源：切目录时网格选中会清空，但工具不应该跟着变空。
 */
export function MatchWorkspace() {
  const selectedEntry = useAppStore((state) => state.selectedDirectoryEntry);
  const rememberedSource = useAppStore((state) => state.matchSourcePath);
  const showMatchWorkspace = useAppStore((state) => state.showMatchWorkspace);
  const [sourcePath, setSourcePath] = useState<string | null>(
    selectedEntry && !selectedEntry.isDirectory ? selectedEntry.path : rememberedSource,
  );
  const [dragOver, setDragOver] = useState(false);

  // 网格里点中新素材才替换源画面；选中被清空（例如切了目录）时保留上一张，
  // 否则右侧工具会在浏览过程中莫名其妙变空。
  useEffect(() => {
    if (selectedEntry && !selectedEntry.isDirectory) {
      setSourcePath(selectedEntry.path);
    }
  }, [selectedEntry]);

  // 拖到面板外松手时浏览器不一定发 dragleave，高亮会一直挂着；
  // 统一在全局 drop / dragend 时收尾。
  useEffect(() => {
    const clear = () => setDragOver(false);
    window.addEventListener("drop", clear);
    window.addEventListener("dragend", clear);
    return () => {
      window.removeEventListener("drop", clear);
      window.removeEventListener("dragend", clear);
    };
  }, []);

  const acceptSource = (path: string) => {
    setSourcePath(path);
    showMatchWorkspace(path);
  };

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
        <ReferenceMatchStudio
          sourcePath={sourcePath}
          onChangeSource={() => void pickSource()}
        />
      </div>
    </aside>
  );
}
