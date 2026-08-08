import { describe, expect, it } from "vitest";
import {
  aiDesignRequestSchema,
  aiJobIdSchema,
  aiProviderKindSchema,
} from "../../../src/main/ipc/schemas";

describe("AI IPC shared Zod schemas (FND-008 §9.1)", () => {
  it("accepts a valid design request", () => {
    const parsed = aiDesignRequestSchema.safeParse({
      sourcePath: "D:\\src\\a.png",
      referencePaths: ["D:\\ref\\r1.png", "D:\\ref\\r2.png"],
      prompt: "  cinematic  ",
      majorChange: true,
      outputCount: 3,
      outputDirectory: "D:\\out",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.prompt).toBe("cinematic");
    }
  });

  it("rejects >6 references, empty prompt, out-of-range outputCount and missing fields", () => {
    const base = {
      sourcePath: "D:\\a.png",
      referencePaths: [],
      prompt: "x",
      majorChange: false,
      outputCount: 2,
      outputDirectory: "D:\\out",
    };
    expect(
      aiDesignRequestSchema.safeParse({
        ...base,
        referencePaths: Array.from({ length: 7 }, () => "D:\\r.png"),
      }).success,
    ).toBe(false);
    expect(
      aiDesignRequestSchema.safeParse({ ...base, prompt: "   " }).success,
    ).toBe(false);
    expect(aiDesignRequestSchema.safeParse({ ...base, outputCount: 5 }).success).toBe(
      false,
    );
    expect(aiDesignRequestSchema.safeParse({ ...base, sourcePath: "" }).success).toBe(
      false,
    );
    // 缺 outputDirectory 字段（用类型断言构造运行时缺字段对象）。
    const withoutOutput = base as unknown as { outputDirectory?: string };
    delete withoutOutput.outputDirectory;
    expect(aiDesignRequestSchema.safeParse(withoutOutput).success).toBe(false);
  });

  it("accepts 0..6 references and 1..4 outputs", () => {
    for (const count of [0, 1, 6]) {
      expect(
        aiDesignRequestSchema.safeParse({
          sourcePath: "D:\\a.png",
          referencePaths: Array.from({ length: count }, () => "D:\\r.png"),
          prompt: "x",
          majorChange: false,
          outputCount: count === 0 ? 1 : 4,
          outputDirectory: "D:\\out",
        }).success,
      ).toBe(true);
    }
  });

  it("validates provider kind and job id", () => {
    expect(aiProviderKindSchema.safeParse("mock").success).toBe(true);
    expect(aiProviderKindSchema.safeParse("comfyui").success).toBe(true);
    expect(aiProviderKindSchema.safeParse("remote-rest").success).toBe(true);
    expect(aiProviderKindSchema.safeParse("aether").success).toBe(false);
    expect(aiJobIdSchema.safeParse("job-abc").success).toBe(true);
    expect(aiJobIdSchema.safeParse("").success).toBe(false);
  });
});
