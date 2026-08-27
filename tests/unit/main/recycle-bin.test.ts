import { describe, expect, it, vi } from "vitest";
import { moveToRecycleBin } from "../../../src/main/platform/recycle-bin";

describe("moveToRecycleBin", () => {
  it("retries a transient shell failure and then succeeds", async () => {
    const trashItem = vi.fn()
      .mockRejectedValueOnce(new Error("EPERM"))
      .mockResolvedValue(undefined);
    const wait = vi.fn(async () => undefined);

    await expect(moveToRecycleBin("D:\\refs\\asset.png", trashItem, { wait }))
      .resolves.toBeUndefined();

    expect(trashItem).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(75);
  });

  it("reports failure without invoking any permanent-delete fallback", async () => {
    const trashItem = vi.fn(async () => {
      throw new Error("recycle unavailable");
    });
    const wait = vi.fn(async () => undefined);

    await expect(moveToRecycleBin("D:\\refs\\folder", trashItem, {
      attempts: 3,
      wait,
    })).rejects.toThrow("RECYCLE_BIN_FAILED: recycle unavailable");

    expect(trashItem).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
