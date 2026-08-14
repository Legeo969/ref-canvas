import {
  createElement,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import type { AssetRecord } from "../../shared/contracts";

export type PreviewRendererKind =
  | "image"
  | "hdr"
  | "video"
  | "audio"
  | "pdf"
  | "model3d"
  | "font"
  | "generic";

type PreviewSessionElement = "aside" | "div" | "main" | "section";

interface PreviewSessionShellProps extends HTMLAttributes<HTMLElement> {
  as?: PreviewSessionElement;
  elementRef?: Ref<HTMLElement>;
  focused?: boolean;
  fullscreen?: boolean;
}

export function previewRendererKind(
  asset: Pick<AssetRecord, "extension" | "kind">,
): PreviewRendererKind {
  const extension = asset.extension.toLowerCase();
  if (asset.kind === "image" && (extension === "exr" || extension === "hdr")) {
    return "hdr";
  }
  switch (asset.kind) {
    case "image":
    case "video":
    case "audio":
    case "pdf":
    case "model3d":
    case "font":
      return asset.kind;
    default:
      return "generic";
  }
}

/** Shared outer boundary for detail, quick and floating preview sessions. */
export function PreviewSessionShell({
  as = "section",
  elementRef,
  focused = false,
  fullscreen = false,
  className = "",
  ...props
}: PreviewSessionShellProps) {
  const sessionClassName = [
    "preview-session-shell",
    className,
    focused ? "preview-session-focused" : "",
    // 全屏预览走窗口级系统全屏（无 :fullscreen 伪类），用类承载原本
    // 由 :fullscreen 伪类提供的沉浸样式。
    fullscreen ? "preview-session-window-fullscreen" : "",
  ].filter(Boolean).join(" ");
  return createElement(as, {
    ...props,
    ref: elementRef,
    className: sessionClassName,
    "data-preview-focused": focused ? "true" : "false",
    "data-preview-fullscreen": fullscreen ? "true" : "false",
  });
}

export function PreviewSessionTitle({
  title,
  subtitle,
  className = "",
  titleClassName = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  titleClassName?: string;
}) {
  return (
    <div className={`preview-session-title-region ${className}`.trim()}>
      <div className={`preview-session-title ${titleClassName}`.trim()}>{title}</div>
      {subtitle != null && <div className="preview-session-subtitle">{subtitle}</div>}
    </div>
  );
}

export function PreviewSurface({
  renderer,
  className = "",
  children,
  controls,
}: {
  renderer: PreviewRendererKind;
  className?: string;
  children: ReactNode;
  controls?: ReactNode;
}) {
  return (
    <div
      className={`preview-surface preview-surface-${renderer} ${className}`.trim()}
      data-preview-renderer={renderer}
    >
      {children}
      {controls != null && (
        <div className="preview-surface-controls">{controls}</div>
      )}
    </div>
  );
}
