import { Keyboard, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  rankCommandItems,
  recordRecentCommand,
  type CommandSearchItem,
} from "../command-palette";

export interface BoardCommand extends CommandSearchItem {
  disabled?: boolean;
  run(): void | Promise<void>;
}

interface BoardCommandPaletteProps {
  commands: BoardCommand[];
  commandShortcut: string;
  onClose(): void;
  onOpenShortcutSettings(): void;
}

const commandRecentsKey = "refcanvas.board-command-recents.v1";

function loadRecentCommandIds(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(commandRecentsKey) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function BoardCommandPalette({
  commands,
  commandShortcut,
  onClose,
  onOpenShortcutSettings,
}: BoardCommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState(loadRecentCommandIds);
  const results = useMemo(
    () => rankCommandItems(commands, query, recentIds),
    [commands, query, recentIds],
  );
  const selectedIndex =
    results[activeIndex] && !results[activeIndex].disabled
      ? activeIndex
      : results.findIndex((command) => !command.disabled);
  const selectedCommand = results[selectedIndex];
  const recentSet = new Set(recentIds);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const execute = (command: BoardCommand | undefined) => {
    if (!command || command.disabled) return;
    const nextRecent = recordRecentCommand(recentIds, command.id);
    setRecentIds(nextRecent);
    localStorage.setItem(commandRecentsKey, JSON.stringify(nextRecent));
    onClose();
    void command.run();
  };

  const moveSelection = (direction: -1 | 1) => {
    if (!results.length) return;
    setActiveIndex((current) => {
      let next = current;
      for (let offset = 0; offset < results.length; offset += 1) {
        next = (next + direction + results.length) % results.length;
        if (!results[next].disabled) return next;
      }
      return current;
    });
    window.requestAnimationFrame(() =>
      inputRef.current
        ?.closest(".command-palette")
        ?.querySelector(".command-palette-row.selected")
        ?.scrollIntoView({ block: "nearest" }),
    );
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="白板命令"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="command-palette-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(-1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                execute(selectedCommand);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              event.stopPropagation();
            }}
            placeholder="搜索命令，例如“适应全部”或“align”"
            aria-label="搜索白板命令"
            role="combobox"
            aria-expanded="true"
            aria-controls="board-command-results"
            aria-activedescendant={
              selectedCommand
                ? `board-command-${selectedCommand.id}`
                : undefined
            }
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>{commandShortcut.replaceAll("+", " ")}</kbd>
        </header>
        <div
          className="command-palette-results"
          id="board-command-results"
          role="listbox"
          onWheel={(event) => event.stopPropagation()}
        >
          {!results.length && (
            <div className="command-palette-empty">
              <Search size={18} />
              <strong>没有匹配的命令</strong>
              <span>可搜索中文名称、功能分组或英文关键词</span>
            </div>
          )}
          {results.map((command, index) => (
            <button
              className={`command-palette-row ${
                index === selectedIndex ? "selected" : ""
              }`}
              id={`board-command-${command.id}`}
              key={command.id}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              aria-disabled={command.disabled || undefined}
              disabled={command.disabled}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => execute(command)}
            >
              <span className="command-palette-copy">
                <strong>{command.label}</strong>
                <span>
                  {command.group}
                  {!query && recentSet.has(command.id) && <em>最近</em>}
                </span>
              </span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
        <footer className="command-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenShortcutSettings();
            }}
          >
            <Keyboard size={13} />
            快捷键设置
          </button>
          <span>{results.length} 个命令</span>
        </footer>
      </section>
    </div>
  );
}
