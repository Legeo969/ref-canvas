import { describe, expect, it, vi } from "vitest";
import { PreviewQueue } from "../../../src/main/platform/preview-queue";

describe("PreviewQueue", () => {
  it("deduplicates queued and active work by key", async () => {
    const queue = new PreviewQueue<string>(1, 8);
    let release!: () => void;
    const first = queue.enqueue(
      "same",
      () => new Promise<string>((resolve) => (release = () => resolve("ok"))),
    );
    const duplicate = queue.enqueue("same", async () => "wrong");

    expect(duplicate).toBe(first);
    expect(queue.stats()).toMatchObject({ active: 1, queued: 0, inFlight: 1 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await expect(first).resolves.toBe("ok");
    expect(queue.stats()).toEqual({ active: 0, queued: 0, inFlight: 0 });
  });

  it("keeps concurrency bounded and continues after failures", async () => {
    const queue = new PreviewQueue<number>(2, 8);
    let active = 0;
    let maximumActive = 0;
    const task = (value: number, failed = false) =>
      queue.enqueue(`key-${value}`, async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        if (failed) throw new Error("failed");
        return value;
      });

    const results = await Promise.allSettled([
      task(1),
      task(2, true),
      task(3),
      task(4),
    ]);
    expect(maximumActive).toBe(2);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
  });

  it("rejects new work when the waiting queue is full", async () => {
    const queue = new PreviewQueue<number>(1, 1);
    let release!: () => void;
    const active = queue.enqueue(
      "active",
      () => new Promise<number>((resolve) => (release = () => resolve(1))),
    );
    const queued = queue.enqueue("queued", async () => 2);
    await expect(queue.enqueue("overflow", async () => 3)).rejects.toThrow(
      "PREVIEW_QUEUE_FULL",
    );
    release();
    await expect(active).resolves.toBe(1);
    await expect(queued).resolves.toBe(2);
  });

  it("runs lower priority values first and promotes duplicate work", async () => {
    const queue = new PreviewQueue<string>(1, 8);
    let release!: () => void;
    const order: string[] = [];
    const active = queue.enqueue("active", () => new Promise<string>((resolve) => {
      release = () => resolve("active");
    }));
    queue.enqueue("background", async () => {
      order.push("background");
      return "background";
    }, { priority: 30 });
    const visible = queue.enqueue("visible", async () => {
      order.push("visible");
      return "visible";
    }, { priority: 20 });
    const promoted = queue.enqueue("background", async () => "wrong", {
      priority: 10,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await active;
    await Promise.all([visible, promoted]);
    expect(order).toEqual(["background", "visible"]);
  });

  it("cancels queued work after all signal consumers leave", async () => {
    const queue = new PreviewQueue<string>(1, 8);
    let release!: () => void;
    const active = queue.enqueue("active", () => new Promise<string>((resolve) => {
      release = () => resolve("done");
    }));
    const first = new AbortController();
    const second = new AbortController();
    const queued = queue.enqueue("queued", async () => "wrong", {
      signal: first.signal,
    });
    expect(queue.enqueue("queued", async () => "wrong", {
      signal: second.signal,
    })).toBe(queued);
    first.abort();
    expect(queue.stats().queued).toBe(1);
    second.abort();
    await expect(queued).rejects.toThrow("PREVIEW_QUEUE_ABORTED");
    release();
    await active;
  });

  it("keeps an active task running after its last signal consumer leaves", async () => {
    // 布局拖拽会高频作废旧预览请求：在途解码结果会写入持久缓存，中止只
    // 会让下一次相同请求从头再来（回归：拖拽时缩略图一直「正在生成预览」）。
    const queue = new PreviewQueue<string>(1, 8);
    let release!: () => void;
    let aborted = false;
    const consumer = new AbortController();
    const task = queue.enqueue("active", (signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise<string>((resolve) => (release = () => resolve("done")));
    }, { signal: consumer.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(queue.stats().active).toBe(1);
    consumer.abort();
    expect(aborted).toBe(false);
    expect(queue.stats().active).toBe(1);
    release();
    await expect(task).resolves.toBe("done");
    expect(queue.stats()).toEqual({ active: 0, queued: 0, inFlight: 0 });
  });

  it("lets a new request join the orphaned active task instead of restarting it", async () => {
    const queue = new PreviewQueue<string>(1, 8);
    let release!: () => void;
    const consumer = new AbortController();
    const first = queue.enqueue("active", () => new Promise<string>((resolve) => {
      release = () => resolve("done");
    }), { signal: consumer.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    consumer.abort();
    const rejoined = queue.enqueue("active", async () => "wrong");
    expect(rejoined).toBe(first);
    release();
    await expect(rejoined).resolves.toBe("done");
  });

  it("ages queued work so continuous high-priority injection cannot starve it", async () => {
    // 序列播放时每帧注入 priority=0 的 preview 请求，visible 缩略图（10）
    // 会被永远排在队尾（回归：目录序列缩略图一直「正在生成预览」）。
    vi.useFakeTimers();
    const queue = new PreviewQueue<string>(1, 8);
    let release!: () => void;
    const order: string[] = [];
    const active = queue.enqueue("active", () => new Promise<string>((resolve) => {
      release = () => resolve("active");
    }));
    const thumbnail = queue.enqueue("thumbnail", async () => {
      order.push("thumbnail");
      return "thumbnail";
    }, { priority: 10 });
    const preview1 = queue.enqueue("preview-1", async () => {
      order.push("preview-1");
      return "preview-1";
    }, { priority: 0 });
    const preview2 = queue.enqueue("preview-2", async () => {
      order.push("preview-2");
      return "preview-2";
    }, { priority: 0 });
    // 等待超过老化阈值：thumbnail 的优先级衰减到与 preview 相同，按先来先服务执行。
    await vi.advanceTimersByTimeAsync(20_000);
    release();
    await active;
    await Promise.all([thumbnail, preview1, preview2]);
    expect(order[0]).toBe("thumbnail");
    vi.useRealTimers();
  });

  it("never lets aged prefetch work jump ahead of display requests", async () => {
    // 全屏批量预热：prefetch(30) 排队极久后若无限老化会升到 0，插到当前帧
    // 显示请求（preview 0）前面——播放反而更卡。prefetch 类必须保持下限。
    vi.useFakeTimers();
    const queue = new PreviewQueue<string>(1, 8);
    let release!: () => void;
    const order: string[] = [];
    const active = queue.enqueue("active", () => new Promise<string>((resolve) => {
      release = () => resolve("active");
    }));
    const preview = queue.enqueue("preview", async () => {
      order.push("preview");
      return "preview";
    }, { priority: 0 });
    const prefetch = queue.enqueue("prefetch", async () => {
      order.push("prefetch");
      return "prefetch";
    }, { priority: 30 });
    // 远超任何老化阈值：prefetch 若不设下限会与 preview 同权。
    await vi.advanceTimersByTimeAsync(60_000);
    release();
    await active;
    await Promise.all([preview, prefetch]);
    expect(order).toEqual(["preview", "prefetch"]);
    vi.useRealTimers();
  });
});
