import path from "node:path";
import { thumbnailCacheFilename } from "./thumbnail-cache";

export interface NativeDragIconImage {
  isEmpty(): boolean;
}

export interface NativeDragIconSources<T extends NativeDragIconImage> {
  createFromPath(filePath: string): T;
  createFromDataUrl(dataUrl: string): T;
}

export interface NativeDragThumbnailLookup {
  getAssetByPath(filename: string): {
    id: string;
    mtimeMs: number;
    size: number;
    fingerprint: string;
  } | null;
  thumbnailCacheDirectory: string;
}

/**
 * 内嵌兜底图标：64×64 通用文件图标（页面 + 折叠角 + 蓝色装饰条）。
 * 仅当应用图标缺失时使用；保证 startDrag 永不收到空图标。
 */
export const FALLBACK_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFISURBVHhe7dU9SgRBFEXhWqVrcSUiooGBGrgAt2AgE4mJIAgygRMYjCMqAy1XKhHu0Frzqp0qzoOT9d/7gq7EMD/n6PTy/uD4fOg17ZdX9aOLVm/vYT08zofrm9s/9TRf2GdFpP3yqn52AUDVQmgGQNVAaApARSM0B6AiEZoEUFEIzQKoCITJAZ4XL98IUS1fV/Y9v21ygF0LAAAAACCv6gcAAACwN/ZSMcDs7mM4u/oMS89z76ldMYA+em9/HZae595TOwAA4B9QBtBLAAAAAAB5VT+bAKJPgW0rPUWKAfRSd57/V/oe951jAQAA/4AygF4CAAAAAMir+tkEMPUpUPqXH6sYQB/lzuNa6X3uO7YNAAD4B5QB9BIAAAAAQF7VDwAAAGBv7CUAAAAAgLyqHwAAAMDe2EujAIcnF0td1GvaL6/KpJTSF6U4Ifd84gGmAAAAAElFTkSuQmCC";

/**
 * 解析原生拖拽图标，保证返回非空。
 *
 * Electron 的 webContents.startDrag 在 icon 为空时静默返回，拖拽根本不会开始
 * （electron_api_web_contents.cc 中 icon->image().IsEmpty() 时直接 return）。
 * 非图片文件（.blend/.fbx 等）用 nativeImage.createFromPath 读不出图标，
 * 因此必须逐级兜底：
 * 1. 原文件直接读取（图片文件天然可用）；
 * 2. 已索引的非图片素材：优先用缩略图缓存（.blend/.abc 有渲染缩略图）；
 * 3. 应用图标 assets/app/refcanvas.png（与托盘图标同一来源）；
 * 4. 内嵌 64×64 通用文件图标（理论上不可达，仅保证契约）。
 */
export function resolveNativeDragIcon<T extends NativeDragIconImage>(
  filePath: string,
  sources: NativeDragIconSources<T>,
  lookup: NativeDragThumbnailLookup | undefined,
  appPath: string,
): T {
  const direct = sources.createFromPath(filePath);
  if (!direct.isEmpty()) return direct;

  const lookupResult = lookup?.getAssetByPath(filePath);
  if (lookup && lookupResult) {
    const cached = sources.createFromPath(
      path.join(
        lookup.thumbnailCacheDirectory,
        thumbnailCacheFilename(lookupResult),
      ),
    );
    if (!cached.isEmpty()) return cached;
  }

  const appIcon = sources.createFromPath(
    path.join(appPath, "assets", "app", "refcanvas.png"),
  );
  if (!appIcon.isEmpty()) return appIcon;

  return sources.createFromDataUrl(FALLBACK_ICON_DATA_URL);
}
