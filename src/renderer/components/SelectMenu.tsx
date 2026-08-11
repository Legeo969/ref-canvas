import { Check, ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { placeTriggerMenu } from "../app/menu-position";

export interface SelectMenuOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectMenuProps<T extends string | number> {
  value: T;
  options: readonly SelectMenuOption<T>[];
  onValueChange(value: T): void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

interface SelectMenuPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  opensAbove: boolean;
}

export function SelectMenu<T extends string | number>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className = "",
  disabled = false,
}: SelectMenuProps<T>) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value)),
  );
  const [placement, setPlacement] = useState<SelectMenuPlacement | null>(null);
  const selected =
    options.find((option) => option.value === value) ?? options[0] ?? null;

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const estimatedHeight = Math.min(options.length * 40 + 10, 330);
    const menuHeight = menuRef.current?.offsetHeight || estimatedHeight;
    const next = placeTriggerMenu(
      triggerRect,
      { width: triggerRect.width, height: menuHeight },
      { width: window.innerWidth, height: window.innerHeight },
      5,
      8,
    );
    setPlacement({
      ...next,
      width: triggerRect.width,
      opensAbove: next.top < triggerRect.top,
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    updatePlacement();
  }, [open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(Math.max(0, selectedIndex));
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const reposition = () => updatePlacement();
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, options, updatePlacement, value]);

  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return;
    let next = activeIndex;
    for (let count = 0; count < options.length; count += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      const index = options.findIndex((option) => !option.disabled);
      if (index >= 0) setActiveIndex(index);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (options[index]?.disabled) continue;
        setActiveIndex(index);
        break;
      }
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`select-menu-trigger${open ? " open" : ""}${
          className ? ` ${className}` : ""
        }`}
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label ?? "—"}</span>
        <ChevronDown className="select-menu-chevron" size={15} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className={`select-menu-popover${placement?.opensAbove ? " opens-above" : ""}`}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              left: placement?.left ?? 0,
              top: placement?.top ?? 0,
              width: placement?.width ?? triggerRef.current?.offsetWidth ?? 160,
              maxHeight: placement?.maxHeight ?? 320,
              visibility: placement ? "visible" : "hidden",
            }}
          >
            {options.map((option, index) => (
              <button
                type="button"
                id={`${menuId}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={`${option.value === value ? "selected" : ""}${
                  index === activeIndex ? " active" : ""
                }`}
                disabled={option.disabled}
                key={`${String(option.value)}-${index}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                <Check size={15} aria-hidden="true" />
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
