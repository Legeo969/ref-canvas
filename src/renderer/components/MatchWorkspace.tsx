import { ImagePlus } from "lucide-react";
import { useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { translate } from "../app/i18n";
import { useAppStore } from "../app/store";
import { DIRECTORY_ENTRY_MIME } from "./DirectoryAssetPanel";
import { ReferenceMatchStudio } from "./ReferenceMatchStudio";

/**
 * 参考图仿色工作区（与“磁盘 / 参考板”并列的顶级工作区）。
 *
 * 这块工具要同时摆下分屏对比、示波器与一整套参数，还得能直接看到导出的
 * cube 会挂在什么工作空间上。预览托盘只有四五百像素，塞不下，所以它是一整块
 * 工作区，而不是预览里的浮层。
 */
export function MatchWorkspace() {
  const sourcePath = useAppStore((state) => state.matchSourcePath);
  const showMatchWorkspace = useAppStore((state) => state.showMatchWorkspace);
  const [dragOver, setDragOver] = useState(false);

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

  if (!sourcePath) {
    return (
      <section
        className={`match-workspace match-workspace-empty${dragOver ? " is-drag-over" : ""}`}
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
        <button type="button" className="match-workspace-dropzone" onClick={() => void pickSource()}>
          <ImagePlus size={22} aria-hidden="true" />
          <strong>{translate("preview.matchPickSource")}</strong>
          <span>{translate("preview.matchSourceHint")}</span>
        </button>
      </section>
    );
  }

  return (
    <section
      className={`match-workspace${dragOver ? " is-drag-over" : ""}`}
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
      <ReferenceMatchStudio
        key={sourcePath}
        sourcePath={sourcePath}
        onChangeSource={() => void pickSource()}
      />
    </section>
  );
}
