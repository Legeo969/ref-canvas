import { z } from "zod";
import { assetKinds } from "../shared/contracts";

/**
 * Utility-process 各操作输入 schema（provider.ts 分发的校验点）。
 *
 * 独立成模块以便单测：provider.ts 入口含 parentPort 检查，无法在测试中
 * 直接 import。Zod 默认剥离未知键——thumbnail 的 OCIO 字段曾因此被静默
 * 丢弃，导致显式色彩变换看起来生效、实际每次都按默认变换解码（ADR-0001
 * 相关修复）。
 */
export const providerInputBase = z.object({
  path: z.string().min(1).max(32_768),
  kind: z.enum(assetKinds),
  extension: z.string().min(1).max(32),
});

export const providerInputSchemas = {
  probe: providerInputBase.extend({ size: z.number().nonnegative() }),
  metadata: providerInputBase,
  thumbnail: providerInputBase.extend({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    outputPath: z.string().min(1).max(32_768).optional(),
    channel: z.string().min(1).max(256).optional(),
    // Keep HDR display-transform options across the utility-process boundary.
    // Zod strips unknown keys by default, which previously made OCIO clicks
    // look successful while every EXR was decoded with the default transform.
    ocioConfigPath: z.string().min(1).max(32_768).optional(),
    inputColorSpace: z.string().min(1).max(128).optional(),
    displayTransform: z.enum(["linear-srgb", "aces-1.3", "aces-2.0", "raw"]).optional(),
  }),
  waveform: providerInputBase.extend({ samples: z.number().int().nonnegative() }),
  preview: providerInputBase.extend({ variant: z.string().min(1).max(128) }),
  convert: providerInputBase.extend({
    targetFormat: z.string().min(1).max(16),
    options: z.record(z.string(), z.unknown()),
  }),
} as const;
