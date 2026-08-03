/**
 * 目录浏览的剪切/复制/粘贴剪贴板（计划 §8.2）。
 *
 * 只保存路径引用，不复制文件内容；粘贴时对 copy 走 filesystem.copy、
 * 对 cut 走 filesystem.move。模块级单例，跨目录导航保持。
 *
 * 通过订阅函数让 React 感知变化（组件用 useState 包裹），避免粘贴条
 * 因模块级状态不触发渲染而不可见。
 */

export type ClipboardMode = "copy" | "cut";

export interface DirectoryClipboard {
  paths: string[];
  mode: ClipboardMode;
  /** 来源目录（用于剪切后刷新来源目录）。 */
  sourceDirectory: string | null;
}

let clipboard: DirectoryClipboard | null = null;
const listeners = new Set<(next: DirectoryClipboard | null) => void>();

export function subscribeDirectoryClipboard(
  listener: (next: DirectoryClipboard | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDirectoryClipboard(): DirectoryClipboard | null {
  return clipboard;
}

export function setDirectoryClipboard(next: DirectoryClipboard | null): void {
  clipboard = next;
  for (const listener of listeners) listener(clipboard);
}

export function clearDirectoryClipboard(): void {
  setDirectoryClipboard(null);
}
