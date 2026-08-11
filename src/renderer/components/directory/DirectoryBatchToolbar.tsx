import {
  Copy,
  Film,
  FolderOpen,
  PanelsTopLeft,
  Scissors,
  Tags,
  Trash2,
  X,
} from "lucide-react";

export function DirectoryBatchToolbar({
  selectedCount,
  allMatchingSelected,
  selectedVideoCount,
  onAddToBoard,
  onCopyPaths,
  onOpenVideoGif,
  onCopyTo,
  onMoveTo,
  onClipboardCopy,
  onClipboardCut,
  onTag,
  onTrash,
  onClear,
}: {
  selectedCount: number;
  allMatchingSelected: boolean;
  selectedVideoCount: number;
  onAddToBoard(): void;
  onCopyPaths(): void;
  onOpenVideoGif(): void;
  onCopyTo(): void;
  onMoveTo(): void;
  onClipboardCopy(): void;
  onClipboardCut(): void;
  onTag(): void;
  onTrash(): void;
  onClear(): void;
}) {
  if (selectedCount <= 0) return null;
  return (
    <div className="batch-toolbar">
      <span>{selectedCount} 项已选</span>
      <button onClick={onAddToBoard} title="加入参考板" aria-label="加入参考板"><PanelsTopLeft size={14} /></button>
      <button onClick={onCopyPaths} title={allMatchingSelected ? "导出 UTF-8 路径清单" : "复制选中文件路径"}><Copy size={14} /></button>
      {selectedVideoCount > 0 && (
        <button onClick={onOpenVideoGif} title={`用 ${selectedVideoCount} 个视频片段生成 GIF`} aria-label="打开多视频 GIF 工作台"><Film size={14} /></button>
      )}
      <button onClick={onCopyTo} title="复制到…"><Copy size={14} /></button>
      <button onClick={onMoveTo} title="移动到…"><FolderOpen size={14} /></button>
      <button onClick={onClipboardCopy} title="复制（到剪贴板）"><Copy size={14} /></button>
      <button onClick={onClipboardCut} title="剪切"><Scissors size={14} /></button>
      <button onClick={onTag} title="设置标签"><Tags size={14} /></button>
      <button className="danger" onClick={onTrash} title="移入回收站"><Trash2 size={14} /></button>
      <button className="danger" onClick={onClear} title="清除选择"><X size={14} /></button>
    </div>
  );
}
