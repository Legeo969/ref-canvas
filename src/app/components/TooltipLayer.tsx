import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface TooltipData {
  label: string;
  shortcut: string;
  rect: DOMRect;
}

export function TooltipLayer() {
  const [data, setData] = useState<TooltipData | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLButtonElement | null>(null);

  const clearTimers = () => {
    if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    showTimerRef.current = null;
    clearTimerRef.current = null;
  };

  const hide = () => {
    clearTimers();
    targetRef.current = null;
    setVisible(false);
    clearTimerRef.current = window.setTimeout(() => setData(null), 140);
  };

  const show = (target: HTMLButtonElement, immediate: boolean) => {
    if (target.disabled || !target.getAttribute("aria-label")) return;
    clearTimers();
    targetRef.current = target;
    const reveal = () => {
      setData({
        label: target.getAttribute("aria-label") ?? "",
        shortcut: target.dataset.shortcut ?? "",
        rect: target.getBoundingClientRect(),
      });
      window.requestAnimationFrame(() => setVisible(true));
    };
    if (immediate) reveal();
    else showTimerRef.current = window.setTimeout(reveal, 350);
  };

  useLayoutEffect(() => {
    if (!data || !tooltipRef.current) return;
    const bounds = tooltipRef.current.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - bounds.width - 8,
      Math.max(8, data.rect.left + data.rect.width / 2 - bounds.width / 2),
    );
    const below = data.rect.bottom + 8;
    const top =
      below + bounds.height <= window.innerHeight - 8
        ? below
        : Math.max(8, data.rect.top - bounds.height - 8);
    setPosition({ left, top });
  }, [data]);

  useEffect(() => {
    const findTarget = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLButtonElement>("button[aria-label]")
        : null;
    const onPointerOver = (event: PointerEvent) => {
      const target = findTarget(event.target);
      if (target && target !== targetRef.current) show(target, false);
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = findTarget(event.target);
      if (
        target &&
        event.relatedTarget instanceof Node &&
        target.contains(event.relatedTarget)
      ) {
        return;
      }
      if (target === targetRef.current) hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = findTarget(event.target);
      if (target) show(target, true);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (findTarget(event.target) === targetRef.current) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimers();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return createPortal(
    <div
      ref={tooltipRef}
      className={`app-tooltip ${visible ? "visible" : ""}`}
      role="tooltip"
      style={{ left: position.left, top: position.top }}
    >
      <span>{data?.label}</span>
      {data?.shortcut && <kbd>{data.shortcut}</kbd>}
    </div>,
    document.body,
  );
}
