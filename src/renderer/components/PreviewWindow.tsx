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
import { AssetPreview } from "./AssetPreview";

interface PreviewWindowProps {
  path: string;
  onClose(): void;
}

export function PreviewWindow({ path, onClose }: PreviewWindowProps) {
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [failed, setFailed] = useState(false);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <main className="preview-window">
      <header className="preview-window-header">
        <span className="preview-window-title" title={path}>
          {path.split(/[\\/]/).pop() ?? path}
        </span>
        <div className="preview-window-actions">
          <button className="icon-button" onClick={() => void window.refCanvas.filesystem.reveal(path)} aria-label="在资源管理器中显示">
            <FolderOpen size={15} />
          </button>
          <button className="icon-button" onClick={onClose} aria-label="关闭浮动预览">
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="preview-window-body">
        {asset ? (
          <AssetPreview asset={asset} />
        ) : failed ? (
          <p className="preview-window-error">无法加载预览：素材未建立索引或不可访问。</p>
        ) : (
          <p className="preview-window-loading">正在加载预览…</p>
        )}
      </div>
    </main>
  );
}
