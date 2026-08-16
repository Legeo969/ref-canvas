import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * refbrowse:// 会话级 token 注册表与解析。
 *
 * 安全模型：URL 只携带随机 token（绝对路径永不出现在 URL 中）；token →
 * 路径为服务端单向映射。解析时强制 realpath 规范化，仅允许普通文件，
 * 从根上拒绝路径穿越与符号链接逃逸（token 本身即授权）。
 */

export interface PreviewFileInfo {
  isFile: boolean;
}

export interface RefBrowseResolver {
  realpath(filename: string): Promise<string | null>;
  stat(filename: string): Promise<PreviewFileInfo | null>;
}

export function isValidPreviewToken(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    token,
  );
}

export class PreviewTokenRegistry {
  private readonly tokens = new Map<
    string,
    { filename: string; allowedRoot: string }
  >();
  private readonly maxTokens: number;

  constructor(maxTokens = 5_000) {
    this.maxTokens = maxTokens;
  }

  /** 为绝对路径签发（或复用）token；路径需已是绝对路径。 */
  tokenFor(filename: string): string {
    const resolved = path.resolve(filename);
    for (const [candidate, value] of this.tokens) {
      if (value.filename === resolved) return candidate;
    }
    const token = randomUUID();
    this.tokens.set(token, {
      filename: resolved,
      allowedRoot: path.dirname(resolved),
    });
    if (this.tokens.size > this.maxTokens) {
      const oldest = this.tokens.keys().next().value;
      if (oldest) this.tokens.delete(oldest);
    }
    return token;
  }

  /** 会话结束清空全部 token（窗口关闭即失效）。 */
  clear(): void {
    this.tokens.clear();
  }

  size(): number {
    return this.tokens.size;
  }

  /**
   * 解析预览 token → 可服务的绝对路径。
   * 返回 null 表示拒绝（token 无效/过期/符号链接逃逸/非普通文件）。
   */
  async resolve(
    token: string,
    resolver: RefBrowseResolver,
  ): Promise<string | null> {
    return this.resolveRelative(token, null, resolver);
  }

  /** Resolves a file beside the signed source for model textures/buffers. */
  async resolveRelative(
    token: string,
    relativePath: string | null,
    resolver: RefBrowseResolver,
  ): Promise<string | null> {
    if (!isValidPreviewToken(token)) return null;
    const record = this.tokens.get(token);
    if (!record) return null;
    if (relativePath && path.isAbsolute(relativePath)) return null;
    const candidate = relativePath
      ? path.resolve(record.allowedRoot, relativePath)
      : record.filename;
    const [real, realRoot] = await Promise.all([
      resolver.realpath(candidate),
      resolver.realpath(record.allowedRoot),
    ]);
    if (!real || !realRoot) return null;
    const relative = path.relative(realRoot, real);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return null;
    }
    const info = await resolver.stat(real);
    if (!info || !info.isFile) return null;
    return real;
  }
}
