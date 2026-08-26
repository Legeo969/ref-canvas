import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CaptureDeliveryService,
  type CaptureDeliveryTarget,
} from "../../../src/main/services/capture-delivery";

function makeTarget(
  id: number,
  options: { destroyed?: boolean; focused?: boolean } = {},
): CaptureDeliveryTarget & { sent: Array<{ channel: string; payload: unknown }> } {
  return {
    id,
    sent: [],
    isDestroyed: () => options.destroyed ?? false,
    isFocused: () => options.focused ?? false,
    send(channel: string, payload: unknown) {
      this.sent.push({ channel, payload });
    },
  };
}

describe("CaptureDeliveryService（浏览器扩展捕获确认制投递）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("投递给首个存活目标并在回执后清账", () => {
    const main = makeTarget(1);
    const board = makeTarget(2);
    const service = new CaptureDeliveryService({
      getTargets: () => [main, board],
      ackTimeoutMs: 5_000,
    });
    service.deliver({ path: "C:\\cap\\a.png", sourceUrl: "https://x" });
    expect(main.sent).toHaveLength(1);
    expect(board.sent).toHaveLength(0);
    const captureId = (
      main.sent[0].payload as { captureId?: string }
    ).captureId as string;
    service.handleAck(captureId);
    // 回执后超时不再入队。
    vi.advanceTimersByTime(6_000);
    expect(service.queuedCount).toBe(0);
    service.dispose();
  });

  it("聚焦窗口优先收件", () => {
    const main = makeTarget(1);
    const board = makeTarget(2, { focused: true });
    const service = new CaptureDeliveryService({
      getTargets: () => [main, board],
      ackTimeoutMs: 5_000,
    });
    service.deliver({ path: "a.png", sourceUrl: "" });
    expect(board.sent).toHaveLength(1);
    expect(main.sent).toHaveLength(0);
    service.dispose();
  });

  it("无存活目标：立即入队并防抖提示一次", () => {
    const notifyStored = vi.fn();
    const service = new CaptureDeliveryService({
      getTargets: () => [makeTarget(1, { destroyed: true })],
      ackTimeoutMs: 5_000,
      notifyStored,
      notifyDebounceMs: 100,
    });
    service.deliver({ path: "a.png", sourceUrl: "" });
    service.deliver({ path: "b.png", sourceUrl: "" });
    expect(notifyStored).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(notifyStored).toHaveBeenCalledTimes(1);
    expect(notifyStored).toHaveBeenCalledWith(2);
    expect(service.queuedCount).toBe(2);
    service.dispose();
  });

  it("回执超时：入队暂存，目标恢复后 flushQueue 重投成功", async () => {
    let alive = true;
    const main = makeTarget(1);
    const getTargets = vi.fn(() =>
      alive ? [main] : [makeTarget(9, { destroyed: true })],
    );
    const notifyStored = vi.fn();
    const service = new CaptureDeliveryService({
      getTargets,
      ackTimeoutMs: 1_000,
      notifyStored,
      notifyDebounceMs: 10,
    });
    // 第一轮：目标存活但渲染端不回执 → 超时入队。
    service.deliver({ path: "a.png", sourceUrl: "https://x" });
    expect(main.sent).toHaveLength(1);
    vi.advanceTimersByTime(1_100);
    expect(service.queuedCount).toBe(1);
    vi.advanceTimersByTime(20);
    expect(notifyStored).toHaveBeenCalledWith(1);

    // 第二轮：主进程换到新窗口并完成导入回执。
    alive = false;
    const fresh = makeTarget(2);
    getTargets.mockImplementation(() => [fresh]);
    service.flushQueue();
    expect(fresh.sent).toHaveLength(1);
    const captureId = (fresh.sent[0].payload as { captureId?: string })
      .captureId as string;
    service.handleAck(captureId);
    vi.advanceTimersByTime(2_000);
    expect(service.queuedCount).toBe(0);
    service.dispose();
  });

  it("flushQueue 在无存活目标时保留队列", () => {
    const service = new CaptureDeliveryService({
      getTargets: () => [makeTarget(1, { destroyed: true })],
      ackTimeoutMs: 1_000,
    });
    service.deliver({ path: "a.png", sourceUrl: "" });
    expect(service.queuedCount).toBe(1);
    service.flushQueue();
    expect(service.queuedCount).toBe(1);
    service.dispose();
  });
});
