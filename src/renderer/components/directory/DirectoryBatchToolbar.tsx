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
import { translate } from "../../app/i18n";

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
      <span>{translate("directory.itemsSelected").replace("{count}", String(selectedCount))}</span>
      <button onClick={onAddToBoard} title={translate("directory.addToBoard")} aria-label={translate("directory.addToBoard")}><PanelsTopLeft size={14} /></button>
      <button onClick={onCopyPaths} title={allMatchingSelected ? translate("directory.exportUtf8PathList") : translate("directory.copySelectedPaths")}><Copy size={14} /></button>
      {selectedVideoCount > 0 && (
        <button onClick={onOpenVideoGif} title={translate("directory.gifFromVideos").replace("{count}", String(selectedVideoCount))} aria-label={translate("directory.openMultiVideoGifWorkbench")}><Film size={14} /></button>
      )}
      <button onClick={onCopyTo} title={translate("directory.copyTo")}><Copy size={14} /></button>
      <button onClick={onMoveTo} title={translate("directory.moveTo")}><FolderOpen size={14} /></button>
      <button onClick={onClipboardCopy} title={translate("directory.copyToClipboard")}><Copy size={14} /></button>
      <button onClick={onClipboardCut} title={translate("directory.cut")}><Scissors size={14} /></button>
      <button onClick={onTag} title={translate("preview.setTags")}><Tags size={14} /></button>
      <button className="danger" onClick={onTrash} title={translate("preview.moveToTrash")}><Trash2 size={14} /></button>
      <button className="danger" onClick={onClear} title={translate("directory.clearSelection")}><X size={14} /></button>
    </div>
  );
}
