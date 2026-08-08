// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskSnapshot } from "../../../../src/shared/contracts";
import { TaskCenter } from "../../../../src/renderer/components/TaskCenter";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function task(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id: "task-1",
    kind: "import",
    state: "running",
    stage: "importing",
    progress: 0.5,
    output: "D:\\refs",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T10:00:01.000Z",
    ...overrides,
  };
}

describe("TaskCenter (FND-007 §8.3)", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("renders aggregated tasks with state and progress", async () => {
    const tasks = {
      list: vi.fn(async () => [
        task(),
        task({ id: "t2", kind: "ai", state: "completed", stage: "completed", progress: 1 }),
        task({ id: "t3", kind: "batch", state: "failed", stage: "failed", errorMessage: "2 项失败" }),
      ]),
      get: vi.fn(async () => null),
      cancel: vi.fn(async () => null),
      onChanged: () => () => undefined,
    };
    Object.assign(window, { refCanvas: { tasks, ai: { retry: vi.fn(async () => null) } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<TaskCenter onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Task Center");
    expect(host.textContent).toContain("导入");
    expect(host.textContent).toContain("AI");
    expect(host.textContent).toContain("批处理");
    expect(host.textContent).toContain("50%");
    expect(host.textContent).toContain("2 项失败");
  });

  it("cancels a running task through the row action", async () => {
    const tasks = {
      list: vi.fn(async () => [task()]),
      get: vi.fn(async () => null),
      cancel: vi.fn(async () => task({ state: "cancelled", stage: "cancelled" })),
      onChanged: () => () => undefined,
    };
    Object.assign(window, { refCanvas: { tasks, ai: { retry: vi.fn(async () => null) } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<TaskCenter onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('[aria-label^="取消任务"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(tasks.cancel).toHaveBeenCalledWith("task-1");
    expect(host.textContent).toContain("已取消");
  });

  it("renders an empty state when there are no tasks", async () => {
    const tasks = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      cancel: vi.fn(async () => null),
      onChanged: () => () => undefined,
    };
    Object.assign(window, { refCanvas: { tasks, ai: { retry: vi.fn(async () => null) } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<TaskCenter onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("No tasks yet");
  });
});
