// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AssetActionSnapshot, RefCanvasApi } from "../../../../src/shared/contracts";
import { ActionsPanel } from "../../../../src/renderer/components/ActionsPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ActionsPanel", () => {
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it("stays hidden until a background job exists", async () => {
    let onProgress: ((snapshot: AssetActionSnapshot) => void) | undefined;
    Object.assign(window, {
      refCanvas: {
        actions: {
          onProgress: (callback: (snapshot: AssetActionSnapshot) => void) => {
            onProgress = callback;
            return () => undefined;
          },
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<ActionsPanel />));

    expect(host.textContent).not.toContain("任务");

    await act(async () => {
      onProgress?.({
        id: "job-1",
        type: "compress",
        state: "running",
        total: 2,
        processed: 1,
        created: 1,
        failed: 0,
        conflicts: [],
        error: null,
        outputDirectory: null,
        items: [],
        createdAt: new Date().toISOString(),
        completedAt: null,
      });
    });

    expect(host.textContent).toContain("任务");
    expect(host.querySelector(".actions-panel")).toBeNull();
  });
});
