import { describe, expect, it } from "vitest";
import { providerInputSchemas } from "../../../src/workers/provider-schemas";

describe("provider input schemas", () => {
  const base = {
    path: "D:\\refs\\shot.exr",
    kind: "image",
    extension: "exr",
  } as const;

  it("keeps HDR display-transform options across the worker boundary", () => {
    const parsed = providerInputSchemas.thumbnail.parse({
      ...base,
      width: 320,
      height: 320,
      ocioConfigPath: "D:\\ocio\\config.ocio",
      inputColorSpace: "ACEScg",
      displayTransform: "aces-1.3",
    });
    expect(parsed).toMatchObject({
      ocioConfigPath: "D:\\ocio\\config.ocio",
      inputColorSpace: "ACEScg",
      displayTransform: "aces-1.3",
    });
  });

  it("accepts the default display transform explicitly", () => {
    const parsed = providerInputSchemas.thumbnail.parse({
      ...base,
      width: 320,
      height: 320,
      displayTransform: "linear-srgb",
    });
    expect(parsed.displayTransform).toBe("linear-srgb");
  });

  it("rejects unknown display transforms", () => {
    expect(() =>
      providerInputSchemas.thumbnail.parse({
        ...base,
        width: 320,
        height: 320,
        displayTransform: "filmic",
      }),
    ).toThrow();
  });

  it("still strips unrelated unknown thumbnail options", () => {
    const parsed = providerInputSchemas.thumbnail.parse({
      ...base,
      width: 320,
      height: 320,
      bogusOption: true,
    });
    expect("bogusOption" in parsed).toBe(false);
  });
});
