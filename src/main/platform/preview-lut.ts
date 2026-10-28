import type { AssetKind } from "../../shared/contracts";

export interface PreviewLutInput {
  /** previewSettings.activeLut；可能是 null，也可能是已失效的路径。 */
  activeLut: string | null;
  /** lutCacheSignature 的结果；LUT 缺失时为 NO_LUT_SIGNATURE（空串）。 */
  lutSignature: string;
  /** 白板代理（?variant=board）不做创意调色。 */
  boardProxy: boolean;
  /**
   * 这张缩略图是不是真正的媒体画面。音频/字体/文本/3D 的缩略图是图标卡片，
   * 给卡片背景上色只会让人以为素材坏了。
   */
  gradeable: boolean;
}

/**
 * 会套 LUT 的资产类型。判断依据是「生成的缩略图是不是真实画面」：音频、
 * 字体、文本、3D 的缩略图是图标卡片，给卡片背景调色只会让人以为素材坏了。
 */
export const GRADED_PREVIEW_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>([
  "image",
  "video",
  "dcc",
]);

/**
 * LUT 生效时预览 URL 不变（缓存键在磁盘上变），必须绕开浏览器 HTTP 缓存，
 * 否则换 LUT 后画面会卡在旧图直到 max-age 过期。
 */
export function previewCacheControl(plan: PreviewLutPlan): string | undefined {
  return plan.lutPath ? "no-store" : undefined;
}

export interface PreviewLutPlan {
  /** 实际交给 ffmpeg 的 LUT；null 表示这张图不调色。 */
  lutPath: string | null;
  /**
   * 追加到缩略图缓存变体后的片段，例如 `lut-a1b2c3d4e5`。
   * 空串表示沿用原缓存键（无 LUT 时不作废历史缓存）。
   */
  variantSuffix: string;
}

/**
 * 决定一次 refasset://thumbnail 请求是否叠加当前 LUT，以及缓存变体后缀。
 * 纯函数：协议层只负责读设置、stat 与真正的 ffmpeg 调用。
 */
export function planPreviewLut(input: PreviewLutInput): PreviewLutPlan {
  if (input.boardProxy || !input.gradeable || !input.activeLut || !input.lutSignature) {
    return { lutPath: null, variantSuffix: "" };
  }
  return {
    lutPath: input.activeLut,
    variantSuffix: `lut-${input.lutSignature}`,
  };
}

/**
 * 把基础变体与 LUT 片段拼成 thumbnailCacheFilename 的 variant 参数。
 * 两者都为空时返回 undefined，保持 `composite` 默认键。
 */
export function previewLutVariant(
  baseVariant: string,
  plan: PreviewLutPlan,
): string | undefined {
  const variant = [baseVariant, plan.variantSuffix].filter(Boolean).join(":");
  return variant || undefined;
}
