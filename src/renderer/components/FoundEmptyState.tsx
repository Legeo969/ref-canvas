import { translate } from "../app/i18n";

/**
 * Found-style empty state: geometric illustration + hint text.
 * Spec §6: triangle play + circle + tilted plate, monochrome #555–#666.
 */
export function FoundEmptyState() {
  return (
    <div className="found-empty-state">
      <div className="found-empty-illustration" aria-hidden="true">
        <div className="play-triangle" />
        <div className="orbit-circle" />
        <div className="tilted-plate" />
      </div>
      <span>{translate("found.preview.emptyHint")}</span>
    </div>
  );
}
