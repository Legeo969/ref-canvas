import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithDirectoryWriteAccess } from "../../../../src/renderer/app/directory-write-access";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("directory write access", () => {
  it("asks once through the native picker, mounts the selection, and retries", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("WRITE_ACCESS_DENIED"))
      .mockResolvedValueOnce("done");
    const pickDirectory = vi.fn(async () => "D:\\refs");
    const add = vi.fn(async (path: string) => ({ path }));
    vi.stubGlobal("window", {
      refCanvas: { system: { pickDirectory }, mounts: { add } },
    });

    await expect(runWithDirectoryWriteAccess("D:\\refs\\shots", operation))
      .resolves.toEqual({ completed: true, value: "done" });
    expect(pickDirectory).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "D:\\refs\\shots",
    }));
    expect(add).toHaveBeenCalledWith("D:\\refs");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the picker is cancelled or selects another folder", async () => {
    for (const selected of [null, "E:\\other"] as const) {
      const operation = vi.fn(async () => {
        throw new Error("WRITE_ACCESS_DENIED");
      });
      const add = vi.fn();
      vi.stubGlobal("window", {
        refCanvas: {
          system: { pickDirectory: vi.fn(async () => selected) },
          mounts: { add },
        },
      });

      await expect(runWithDirectoryWriteAccess("D:\\refs", operation))
        .resolves.toEqual({ completed: false });
      expect(add).not.toHaveBeenCalled();
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });
});
