/**
 * 浮动预览窗口（FND-004 §5 会话连续性）。
 *
 * 只消费单一资产会话：按路径加载 AssetRecord 并渲染统一 AssetPreview。
 * 关闭浮动窗口不会影响主窗口；主窗口退出时由 Main 一并关闭并释放资源。
 * 浮动窗口不修改 Board、不访问 AI 密钥，也不获得额外文件系统能力。
 */
import { FolderOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import { translate } from "../app/i18n";
import { AssetPreview } from "./AssetPreview";
import {
  PreviewSessionModeButtons,
  usePreviewSessionMode,
} from "./PreviewSessionMode";
import {
  PreviewSessionShell,
  PreviewSessionTitle,
  PreviewSurface,
  previewRendererKind,
} from "./PreviewSessionShell";

interface PreviewWindowProps {
  path: string;
  onClose(): void;
}

export function PreviewWindow({ path, onClose }: PreviewWindowProps) {
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [failed, setFailed] = useState(false);
  const previewSession = usePreviewSessionMode(path, onClose);

  useEffect(() => {
    let cancelled = false;
    setAsset(null);
    setFailed(false);
    void window.refCanvas.library
      .getByPath(path)
      .then((record) => {
        if (!cancelled) {
          if (record) setAsset(record);
          else setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <PreviewSessionShell
      as="main"
      elementRef={previewSession.rootRef}
      focused={previewSession.focused}
      fullscreen={previewSession.fullscreen}
      className="preview-window"
    >
      <header className="preview-window-header">
        <PreviewSessionTitle
          className="preview-window-title-region"
          titleClassName="preview-window-title"
          title={<span title={path}>{path.split(/[\\/]/).pop() ?? path}</span>}
        />
        <div className="preview-window-actions">
          <PreviewSessionModeButtons
            focused={previewSession.focused}
            fullscreen={previewSession.fullscreen}
            onToggleFocus={previewSession.toggleFocus}
            onToggleFullscreen={() => void previewSession.toggleFullscreen()}
            showFocus={false}
          />
          <button className="icon-button preview-window-external-action" onClick={() => void window.refCanvas.filesystem.reveal(path)} aria-label={translate("preview.reveal")}>
            <FolderOpen size={15} />
          </button>
          <button className="icon-button" onClick={onClose} aria-label={translate("preview.closeFloating")}>
            <X size={15} />
          </button>
        </div>
      </header>
      <PreviewSurface
        renderer={asset ? previewRendererKind(asset) : "generic"}
        className="preview-window-body"
      >
        {asset ? (
          <AssetPreview asset={asset} />
        ) : failed ? (
          <p className="preview-window-error">{translate("preview.error")}</p>
        ) : (
          <p className="preview-window-loading">{translate("preview.loading")}</p>
        )}
      </PreviewSurface>
    </PreviewSessionShell>
  );
}
