import type { ImportJobSnapshot } from "../../../shared/contracts";

const TERMINAL_IMPORT_STATES = new Set(["completed", "cancelled", "failed"]);

export function importJobState(importJob: ImportJobSnapshot): {
  importJob: ImportJobSnapshot;
  importing: boolean;
} {
  return {
    importJob,
    importing: !TERMINAL_IMPORT_STATES.has(importJob.state),
  };
}
