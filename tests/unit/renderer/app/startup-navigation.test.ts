import { describe, expect, it } from "vitest";
import { startupDirectoryCandidates } from "../../../../src/renderer/app/startup-navigation";

describe("startup directory candidates", () => {
  it("keeps remembered and quick-access paths inside accessible roots", () => {
    expect(
      startupDirectoryCandidates({
        rememberedPath: "E:\\shots",
        mounts: [
          { path: "Z:\\offline", state: "offline" },
          { path: "D:\\assets", state: "online" },
        ],
        roots: [
          { path: "C:\\" },
          { path: "E:\\" },
        ],
        quickAccess: [
          { path: "E:\\references" },
          { path: "E:\\references" },
          { path: "F:\\references" },
        ],
      }),
    ).toEqual([
      "E:\\shots",
      "E:\\references",
      "C:\\",
      "E:\\",
      "D:\\assets",
    ]);
  });
});
