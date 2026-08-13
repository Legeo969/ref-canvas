import { describe, expect, it } from "vitest";
import { hdrDisplayPreviewUrl } from "../../../../src/renderer/components/HdrPreview";

describe("HDR display preview source", () => {
  it("uses the high-resolution display-transform endpoint", () => {
    expect(hdrDisplayPreviewUrl("session-token")).toBe(
      "refbrowse://thumbnail/session-token?priority=preview&size=1920",
    );
  });
});
