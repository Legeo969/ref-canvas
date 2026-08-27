import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { translate } from "../../app/i18n";
import { SelectMenu } from "../SelectMenu";

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
  const intervalSeconds = (seconds: number) =>
    translate("board.focusIntervalSeconds").replace("{seconds}", String(seconds));
  return (
    <div className="board-focus-controls" role="group" aria-label={translate("board.focusOverlayLabel")}>
      <div className="board-focus-copy" aria-live="polite">
        <strong title={title}>{title}</strong><span>{index + 1} / {count}</span>
      </div>
      <button onClick={onPrevious} aria-label={translate("board.focusPrevious")} data-shortcut="←"><ChevronLeft size={17} /></button>
      <button className={`focus-play-toggle ${playing ? "active" : ""}`} onClick={onTogglePlaying} aria-label={playing ? translate("board.focusPause") : translate("board.focusPlay")}>
        <span className={`focus-icon-state ${playing ? "" : "shown"}`}><Play size={16} /></span>
        <span className={`focus-icon-state ${playing ? "shown" : ""}`}><Pause size={16} /></span>
      </button>
      <button onClick={onNext} aria-label={translate("board.focusNext")} data-shortcut="→"><ChevronRight size={17} /></button>
      <label>
        <span className="sr-only">{translate("board.focusInterval")}</span>
        <SelectMenu
          value={interval}
          options={[3, 5, 10].map((value) => ({ value, label: intervalSeconds(value) }))}
          ariaLabel={translate("board.focusInterval")}
          onValueChange={onIntervalChange}
          className="focus-select-menu"
        />
      </label>
      <label>
        <span className="sr-only">{translate("board.focusOrder")}</span>
        <SelectMenu
          value={mode}
          options={[
            { value: "order" as const, label: translate("board.focusOrderMode") },
            { value: "shuffle" as const, label: translate("board.focusShuffle") },
            { value: "random" as const, label: translate("board.focusRandom") },
          ]}
          ariaLabel={translate("board.focusOrder")}
          onValueChange={onModeChange}
          className="focus-select-menu focus-order-menu"
        />
      </label>
      <button onClick={onExit} aria-label={translate("board.exitFocus")}><X size={16} /></button>
    </div>
  );
}
