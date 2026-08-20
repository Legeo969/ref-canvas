import { useSyncExternalStore } from "react";

/**
 * 播放时钟：把高频（~60fps）的播放位置单独广播给需要丝滑渲染的滑块，
 * 而不走 React 全树 setState / transport。GIFPreview 的 rAF 循环每帧 publish，
 * 订阅方（如 PreviewSlider）用 useSyncExternalStore 只重渲染自己（叶子组件），
 * 面板/工具栏不随每帧重渲染 → 进度条 60fps 顺滑、整树开销仍低。
 */

export interface PlaybackClockValue {
  /** [0,1] 播放位置（时间码/进度条用）。 */
  position: number;
  /** 是否正在播放。 */
  playing: boolean;
}

let current: PlaybackClockValue | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** 供播放器（GIFPreview 等）每帧调用，替换快照后通知订阅者。 */
export function publishPlaybackClock(position: number, playing: boolean): void {
  current = { position, playing };
  notify();
}

/** 播放器卸载/停止时清空，订阅方回落到 props 值。 */
export function clearPlaybackClock(): void {
  if (current === null) return;
  current = null;
  notify();
}

export function subscribePlaybackClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPlaybackClock(): PlaybackClockValue | null {
  return current;
}

/** 未启用时钟时的稳定 no-op 订阅/读取（不触发重渲染）。 */
export function subscribePlaybackClockNoop(): () => void {
  return () => undefined;
}

export function getPlaybackClockNull(): PlaybackClockValue | null {
  return null;
}

/**
 * 订阅时钟并读位置。仅在 active 为 true 时跟随 60fps 时钟，否则恒返回
 * fallback（组件本身不因时钟重渲染）。
 */
export function usePlaybackClockPosition(
  active: boolean,
  fallback: number,
): number {
  return useSyncExternalStore(
    active ? subscribePlaybackClock : subscribePlaybackClockNoop,
    active ? getPlaybackClock : getPlaybackClockNull,
    active ? getPlaybackClock : getPlaybackClockNull,
  )?.position ?? fallback;
}
