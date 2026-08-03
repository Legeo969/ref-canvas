/**
 * 目录浏览的剪切/复制/粘贴剪贴板（计划 §8.2）。
 *
 * 只保存路径引用，不复制文件内容；粘贴时对 copy 走 filesystem.copy、
 * 对 cut 走 filesystem.move。模块级单例，跨目录导航保持。
 */

export type ClipboardMode = "copy" | "cut";

export interface DirectoryClipboard {
  paths: string[];
  mode: ClipboardMode;
  /** 剪切来源目录（用于剪切后刷新来源目录）。 */
  sourceDirectory: string | null;
}

let clipboard: DirectoryClipboard | null = null;

export function getDirectoryClipboard(): DirectoryClipboard | null {
  return clipboard;
}

export function setDirectoryClipboard(next: DirectoryClipboard | null): void {
  clipboard = next;
}

export function clearDirectoryClipboard(): void {
  clipboard = null;
}
