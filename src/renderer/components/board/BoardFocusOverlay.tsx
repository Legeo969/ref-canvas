import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";

export function BoardFocusOverlay({
  title,
  index,
  count,
  playing,
  interval,
  mode,
  onPrevious,
  onTogglePlaying,
  onNext,
  onIntervalChange,
  onModeChange,
  onExit,
}: {
  title: string;
  index: number;
  count: number;
  playing: boolean;
  interval: number;
  mode: "order" | "shuffle" | "random";
  onPrevious(): void;
  onTogglePlaying(): void;
  onNext(): void;
  onIntervalChange(interval: number): void;
  onModeChange(mode: "order" | "shuffle" | "random"): void;
  onExit(): void;
}) {
  return (
    <div className="board-focus-controls" role="group" aria-label="单图聚焦">
      <div className="board-focus-copy" aria-live="polite">
        <strong title={title}>{title}</strong><span>{index + 1} / {count}</span>
      </div>
      <button onClick={onPrevious} aria-label="上一张" data-shortcut="←"><ChevronLeft size={17} /></button>
      <button className={`focus-play-toggle ${playing ? "active" : ""}`} onClick={onTogglePlaying} aria-label={playing ? "暂停幻灯片" : "播放幻灯片"}>
        <span className={`focus-icon-state ${playing ? "" : "shown"}`}><Play size={16} /></span>
        <span className={`focus-icon-state ${playing ? "shown" : ""}`}><Pause size={16} /></span>
      </button>
      <button onClick={onNext} aria-label="下一张" data-shortcut="→"><ChevronRight size={17} /></button>
      <label>
        <span className="sr-only">幻灯片间隔</span>
        <select value={interval} onChange={(event) => onIntervalChange(Number(event.target.value))} aria-label="幻灯片间隔">
          <option value="3">3 秒</option><option value="5">5 秒</option><option value="10">10 秒</option>
        </select>
      </label>
      <label>
        <span className="sr-only">幻灯片顺序</span>
        <select value={mode} onChange={(event) => onModeChange(event.target.value as "order" | "shuffle" | "random")} aria-label="幻灯片顺序">
          <option value="order">顺序</option><option value="shuffle">洗牌</option><option value="random">随机</option>
        </select>
      </label>
      <button onClick={onExit} aria-label="退出单图聚焦"><X size={16} /></button>
    </div>
  );
}
