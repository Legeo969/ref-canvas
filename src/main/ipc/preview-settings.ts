import {
  PREVIEW_FORMAT_GROUP_DEFAULTS,
  PREVIEW_SETTINGS_DEFAULTS,
  previewFormatGroupIds,
  type PreviewFormatGroup,
  type PreviewSettings,
} from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";

function normalizeExtension(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const extension = value.trim().replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(extension) ? extension : null;
}

function normalizeFormatGroups(
  values: unknown,
  fallback: PreviewFormatGroup[],
): PreviewFormatGroup[] {
  const entries = Array.isArray(values) ? values : [];
  return previewFormatGroupIds.map((id) => {
    const source = entries.find(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && (item as Record<string, unknown>).id === id,
    );
    const defaultGroup = fallback.find((group) => group.id === id) ??
      PREVIEW_FORMAT_GROUP_DEFAULTS.find((group) => group.id === id)!;
    const extensions = Array.from(
      new Set(
        (Array.isArray(source?.extensions) ? source.extensions : defaultGroup.extensions)
          .map(normalizeExtension)
          .filter((extension): extension is string => Boolean(extension)),
      ),
    ).slice(0, 128);
    return {
      id,
      label: typeof source?.label === "string" && source.label.trim()
        ? source.label.trim().slice(0, 32)
        : defaultGroup.label,
      extensions: extensions.length ? extensions : defaultGroup.extensions,
    };
  });
}

function normalizeFormatWhitelist(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) return fallback;
  return Array.from(
    new Set(
      values
        .map(normalizeExtension)
        .filter((extension): extension is string => Boolean(extension)),
    ),
  ).slice(0, 256);
}

function normalizeFpsPresets(values: unknown, fallback: number[]): number[] {
  if (!Array.isArray(values)) return fallback;
  const unique = Array.from(
    new Set(
      values.filter(
        (value): value is number =>
          Number.isInteger(value) && value >= 1 && value <= 240,
      ),
    ),
  );
  return unique.length ? unique.slice(0, 10) : fallback;
}

function normalizeMp4Presets(
  values: unknown,
  fallback: PreviewSettings["mp4Presets"],
): PreviewSettings["mp4Presets"] {
  if (!Array.isArray(values) || values.length === 0) return fallback;
  return values.slice(0, 3).map((value, index) => {
    const preset = value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
    const legacyCrf = typeof preset.crf === "number" ? preset.crf : 20;
    const legacyWidth = typeof preset.maxWidth === "number"
      ? preset.maxWidth
      : null;
    return {
      id: typeof preset.id === "string" ? preset.id : `convert-${index + 1}`,
      label:
        typeof preset.label === "string"
          ? preset.label
          : index === 0
            ? "默认转换"
            : `转换 ${index + 1}`,
      enabled: typeof preset.enabled === "boolean" ? preset.enabled : index === 0,
      codec: preset.codec === "h265" ? "h265" : "h264",
      quality:
        preset.quality === "medium" ||
        preset.quality === "high" ||
        preset.quality === "best"
          ? preset.quality
          : legacyCrf <= 16
            ? "best"
            : legacyCrf <= 20
              ? "high"
              : "medium",
      resolution:
        preset.resolution === "half" || preset.resolution === "quarter"
          ? preset.resolution
          : preset.resolution === "original"
            ? "original"
            : legacyWidth === null || legacyWidth <= 0
              ? "original"
              : legacyWidth >= 1_500
                ? "half"
                : "quarter",
    };
  });
}

/** 合并 previewSettings patch：嵌套对象（flattenPerFolder）合并而非覆盖。 */
export function mergePreviewSettings(
  current: PreviewSettings,
  patch: Partial<PreviewSettings>,
): PreviewSettings {
  const sequenceFpsPresets = normalizeFpsPresets(
    patch.sequenceFpsPresets,
    current.sequenceFpsPresets,
  );
  const mp4Presets = normalizeMp4Presets(
    patch.mp4Presets,
    current.mp4Presets,
  );
  const defaultSequenceFps = sequenceFpsPresets.includes(
    patch.defaultSequenceFps ?? current.defaultSequenceFps,
  )
    ? (patch.defaultSequenceFps ?? current.defaultSequenceFps)
    : sequenceFpsPresets[0];
  const requestedDefaultPreset =
    patch.defaultMp4PresetId ?? current.defaultMp4PresetId;
  const defaultMp4PresetId = mp4Presets.some(
    (preset) => preset.id === requestedDefaultPreset && preset.enabled,
  )
    ? requestedDefaultPreset
    : (mp4Presets.find((preset) => preset.enabled) ?? mp4Presets[0]).id;
  return {
    ...current,
    ...patch,
    formatGroups: normalizeFormatGroups(patch.formatGroups, current.formatGroups),
    formatWhitelist: normalizeFormatWhitelist(
      patch.formatWhitelist,
      current.formatWhitelist,
    ),
    defaultSequenceFps,
    sequenceFpsPresets,
    defaultMp4PresetId,
    flattenPerFolder: patch.flattenPerFolder
      ? { ...current.flattenPerFolder, ...patch.flattenPerFolder }
      : current.flattenPerFolder,
    sequenceRules: patch.sequenceRules ?? current.sequenceRules,
    mp4Presets,
    lutDirectories: patch.lutDirectories ?? current.lutDirectories,
  };
}

/**
 * 读取预览设置：优先新键 previewSettings，回退旧键（升级兼容，
 * 旧版本用户设置不丢失）。语义与 mergePreviewSettings 一致：默认值合并 patch。
 */
export function readPreviewSettings(database: RefCanvasDatabase): PreviewSettings {
  const legacy = database.getSetting<Partial<PreviewSettings> | null>(
    "foundSettings",
    null,
  );
  const current = database.getSetting<Partial<PreviewSettings> | null>(
    "previewSettings",
    null,
  );
  return mergePreviewSettings(PREVIEW_SETTINGS_DEFAULTS, current ?? legacy ?? {});
}
