// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { confirmRemoveMount } from "../../../../src/renderer/app/mount-actions";
import { useAppStore } from "../../../../src/renderer/app/store";

describe("mount removal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("clears the current view and history entries inside the removed mount", async () => {
    const remove = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: {
        mounts: { remove },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      navigationSource: "directory",
      directoryPath: "D:\\refs\\shots",
      directoryEntries: [
        {
          path: "D:\\refs\\shots\\frame.exr",
          name: "frame.exr",
          isDirectory: false,
          extension: "exr",
        },
      ],
      directoryTotal: 1,
      directoryHistory: [
        "D:\\refs\\shots",
        "E:\\other",
        "D:\\refs",
      ],
      directoryHistoryIndex: 0,
      selectedDirectoryEntry: {
        path: "D:\\refs\\shots\\frame.exr",
        name: "frame.exr",
        isDirectory: false,
        extension: "exr",
      },
    });

    const requestConfirm = vi.fn(async () => true);
    const removed = await confirmRemoveMount(
      { requestConfirm },
      {
        id: "mount-1",
        path: "D:\\refs",
        displayName: "Refs",
      },
    );

    expect(removed).toBe(true);
    expect(requestConfirm).toHaveBeenCalledWith({
      title: "移除挂载“Refs”？",
      description: "只停止浏览这个目录。磁盘文件、标签、评分和备注都不会被删除。",
      confirmLabel: "移除挂载",
    });
    expect(remove).toHaveBeenCalledWith("mount-1");
    expect(useAppStore.getState()).toMatchObject({
      directoryPath: null,
      directoryEntries: [],
      directoryTotal: 0,
      directoryHistory: ["E:\\other"],
      directoryHistoryIndex: 0,
      selectedDirectoryEntry: null,
    });
  });
});
