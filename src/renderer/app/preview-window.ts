/**
 * 浮动预览窗口的 URL 参数解析：`?preview=<base64url(path)>&mode=window`。
 * 渲染层据此短路为 PreviewWindow（跳过主窗口 store 初始化，不获得
 * 通用文件系统能力之外的访问；主窗口退出时由 Main 一并关闭）。
 */

export interface PreviewWindowParams {
  mode: "window";
  /** base64url 编码的预览目标路径。 */
  previewPath: string;
}

function decodeBase64Url(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = decodeURIComponent(
      Array.from(
        window.atob(base64),
        (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
      ).join(""),
    );
    return decoded || null;
  } catch {
    return null;
  }
}

/** 解析浮动预览窗口参数；非预览模式或参数非法返回 null。 */
export function parsePreviewWindowParams(
  search: string,
): PreviewWindowParams | null {
  const params = new URLSearchParams(search);
  if (params.get("mode") !== "window") return null;
  const encoded = params.get("preview");
  if (!encoded || encoded.length > 4096) return null;
  const previewPath = decodeBase64Url(encoded);
  if (!previewPath) return null;
  return { mode: "window", previewPath };
}

/** 编码浮动预览 URL（主进程调用）。 */
export function encodePreviewWindowPath(filename: string): string {
  const bytes = new TextEncoder().encode(filename);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
