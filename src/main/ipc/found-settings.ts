import type { FoundSettings } from "../../shared/contracts";

/** 合并 foundSettings patch：嵌套对象（flattenPerFolder）合并而非覆盖。 */
export function mergeFoundSettings(
  current: FoundSettings,
  patch: Partial<FoundSettings>,
): FoundSettings {
  return {
    ...current,
    ...patch,
    flattenPerFolder: patch.flattenPerFolder
      ? { ...current.flattenPerFolder, ...patch.flattenPerFolder }
      : current.flattenPerFolder,
    sequenceRules: patch.sequenceRules ?? current.sequenceRules,
    mp4Presets: patch.mp4Presets ?? current.mp4Presets,
    lutDirectories: patch.lutDirectories ?? current.lutDirectories,
  };
}
