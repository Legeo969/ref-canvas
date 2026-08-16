import { translate } from "../app/i18n";

/**
 * Preview-style empty state: geometric illustration + hint text.
 * Spec §6: triangle play + circle + tilted plate, monochrome #555–#666.
 */
export function PreviewEmptyState() {
  return (
    <div className="preview-empty-state">
      <div className="preview-empty-illustration" aria-hidden="true">
        <div className="play-triangle" />
        <div className="orbit-circle" />
        <div className="tilted-plate" />
      </div>
      <span>{translate("preview.emptyHint")}</span>
    </div>
  );
}
