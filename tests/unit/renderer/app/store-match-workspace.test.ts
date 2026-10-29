/**
 * 参考图仿色是常驻工作区，不是一次性对话框。
 *
 * 用户在网格里换目录、切标签、开集合，都是为了挑下一张素材；这些导航不能
 * 把工作区踢回「磁盘」，否则刚调好的参考图与参数会一起消失。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../../../src/renderer/app/store";

// 这些动作会在后台拉集合列表；测试只关心工作区状态，所以给 IPC 一层
// 永远成功的桩，避免未处理的 rejection 干扰结果。
const asyncStub = new Proxy(
  {},
  { get: () => async () => [] },
) as unknown as Record<string, unknown>;
(globalThis as { window?: unknown }).window = {
  refCanvas: new Proxy(
    {},
    { get: () => asyncStub },
  ),
};

function reset(): void {
  useAppStore.setState({
    workspaceMode: "directory",
    matchSourcePath: null,
    activeCollectionId: null,
    focusMode: false,
  });
}

describe("match workspace navigation", () => {
  beforeEach(reset);

  it("打开集合不会切回磁盘工作区", async () => {
    const store = useAppStore.getState();
    store.showMatchWorkspace("D:/shots/000001.jpg");
    expect(useAppStore.getState().workspaceMode).toBe("match");

    useAppStore.getState().openCollection("collection-1");
    await Promise.resolve();

    expect(useAppStore.getState().workspaceMode).toBe("match");
    expect(useAppStore.getState().matchSourcePath).toBe("D:/shots/000001.jpg");
  });

  it("显式点「磁盘」标签仍然切走并清空源画面", () => {
    useAppStore.getState().showMatchWorkspace("D:/shots/000001.jpg");
    useAppStore.getState().showDirectoryWorkspace();

    expect(useAppStore.getState().workspaceMode).toBe("directory");
    expect(useAppStore.getState().matchSourcePath).toBeNull();
  });
});
