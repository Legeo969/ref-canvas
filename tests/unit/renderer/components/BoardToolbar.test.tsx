// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "../../../../src/renderer/app/i18n";
import {
  BoardToolbar,
  type BoardToolbarCommand,
  type BoardToolbarState,
} from "../../../../src/renderer/components/board/BoardToolbar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const baseState: BoardToolbarState = {
  tool: "select",
  drawingToolActive: false,
  drawingPanelOpen: false,
  arrangePanelOpen: false,
  selectedHasComment: false,
  focused: false,
  layersOpen: false,
  inspectorOpen: false,
  gridVisible: true,
  canvasLocked: false,
  canvasGrayscale: false,
  hasSelection: false,
  selectionHasNote: false,
  selectionCount: 0,
  hasBoardObjects: true,
  toolbarCollapsed: false,
};

function toolbarButton(host: HTMLElement, labelKey: Parameters<typeof translate>[0]) {
  return host.querySelector<HTMLButtonElement>(
    `button[aria-label="${translate(labelKey)}"]`,
  );
}

// 分组期望:与 BoardToolbar.tsx 中 groups 的成员一一对应(标签取 baseState 下的渲染值)。
const groupMembers: Record<string, readonly Parameters<typeof translate>[0][]> = {
  "file-tools": [
    "board.importFiles",
    "board.toolSelect",
    "board.enableDrawing",
    "board.drawingSettings",
    "board.eraser",
    "board.undoStroke",
  ],
  add: [
    "board.addText",
    "board.addNote",
    "board.addChecklist",
    "board.addArrow",
    "board.addRectangle",
    "board.addGuideX",
    "board.addGuideY",
  ],
  transform: [
    "board.moveBottom",
    "board.moveTop",
    "board.moveUpOne",
    "board.moveDownOne",
    "board.rotate90",
    "board.flipH",
    "board.flipV",
    "board.resetTransform",
  ],
  align: [
    "board.alignLeft",
    "board.alignCenterX",
    "board.alignRight",
    "board.alignTop",
    "board.alignCenterY",
    "board.alignBottom",
    "board.distributeX",
    "board.distributeY",
    "board.arrangeCompactSelection",
    "board.arrangeSettings",
    "board.normalizeWidth",
    "board.normalizeHeight",
    "board.uniformArea",
    "board.uniformScale",
  ],
  objects: [
    "board.toggleLock",
    "board.group",
    "board.parentWithHint",
    "board.unparent",
    "board.ungroup",
    "board.maskRectShort",
    "board.maskCircleShort",
    "board.cropImage",
    "board.resetCrop",
    "board.opacity",
    "board.duplicate",
    "board.editContent",
    "board.commentAdd",
    "board.delete",
  ],
  view: [
    "board.undo",
    "board.redo",
    "board.fitAll",
    "board.focusSelection",
    "board.fitSelection",
    "board.exportPngSelection",
    "board.openInspector",
    "board.layersTitle",
    "board.zoom100",
    "board.resetViewport",
  ],
  canvas: [
    "board.hideGrid",
    "board.appearanceTitle",
    "board.lockCanvasWhole",
    "board.canvasGrayscaleWhole",
    "board.gridStyleCycle",
    "board.sampleColor",
  ],
  palette: ["board.commandPaletteTitle"],
};

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

async function renderToolbar(
  state: BoardToolbarState,
  onCommand: (command: BoardToolbarCommand) => void = vi.fn(),
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(<BoardToolbar state={state} onCommand={onCommand} shortcuts={{}} />);
  });
  return host;
}

function renderedGroupIds(host: HTMLElement) {
  return Array.from(
    host.querySelectorAll<HTMLElement>(".toolbar-group[data-group]"),
  ).map((group) => group.dataset.group);
}

describe("BoardToolbar groups and collapse", () => {
  it("renders the seven functional groups plus the palette tail in order", async () => {
    const host = await renderToolbar(baseState);
    expect(renderedGroupIds(host)).toEqual([
      "file-tools",
      "add",
      "transform",
      "align",
      "objects",
      "view",
      "canvas",
      "palette",
    ]);
    // 每组按钮成员与顺序与分组定义一致。
    for (const group of host.querySelectorAll<HTMLElement>(".toolbar-group[data-group]")) {
      const labels = Array.from(group.querySelectorAll("button")).map(
        (button) => button.getAttribute("aria-label"),
      );
      expect(labels, `group ${group.dataset.group}`).toEqual(
        groupMembers[group.dataset.group as string].map((key) => translate(key)),
      );
    }
  });

  it("renders every action exactly once inside a group", async () => {
    const host = await renderToolbar(baseState);
    const buttons = Array.from(host.querySelectorAll("button"));
    // 66 个动作按钮 + 1 个收起开关,全部落在 .toolbar-group 容器内。
    expect(buttons).toHaveLength(67);
    expect(host.querySelectorAll(".toolbar-group button")).toHaveLength(67);
    const expectedLabels = Object.values(groupMembers)
      .flat()
      .map((key) => translate(key))
      .sort();
    const actionLabels = buttons
      .map((button) => button.getAttribute("aria-label"))
      .filter((label) => label !== translate("board.collapseToolbar"))
      .sort();
    expect(actionLabels).toEqual(expectedLabels);
  });

  it("keeps only the file-tools, view and palette groups when collapsed", async () => {
    const host = await renderToolbar({ ...baseState, toolbarCollapsed: true });
    // 收起态单行:添加/变换/对齐/对象/画布组整体不渲染。
    expect(renderedGroupIds(host)).toEqual(["file-tools", "view", "palette"]);
    expect(toolbarButton(host, "board.addText")).toBeNull();
    expect(toolbarButton(host, "board.moveTop")).toBeNull();
    expect(toolbarButton(host, "board.alignLeft")).toBeNull();
    expect(toolbarButton(host, "board.group")).toBeNull();
    expect(toolbarButton(host, "board.hideGrid")).toBeNull();
    // 保留三组的按钮仍在且禁用态不受收起影响。
    expect(toolbarButton(host, "board.importFiles")?.disabled).toBe(false);
    expect(toolbarButton(host, "board.undo")?.disabled).toBe(false);
    expect(toolbarButton(host, "board.commandPaletteTitle")?.disabled).toBe(false);
  });

  it("flips the collapse toggle between collapse and expand affordances", async () => {
    // 默认展开:开关显示「收起」+ 向上箭头,点击派发收起命令。
    const onCommand = vi.fn();
    const expandedHost = await renderToolbar(baseState, onCommand);
    const collapse = expandedHost.querySelector<HTMLButtonElement>("button.toolbar-collapse");
    expect(collapse?.getAttribute("aria-label")).toBe(translate("board.collapseToolbar"));
    // aria-expanded 描述受控工具栏的当前状态:展开即 true。
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");
    expect(collapse?.querySelector("svg")?.getAttribute("class")).toContain("chevron-up");
    await act(async () => {
      collapse?.click();
    });
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith("toggleToolbarCollapsed");

    // 收起态:开关显示「展开」+ 向下箭头。
    const collapsedHost = await renderToolbar({ ...baseState, toolbarCollapsed: true });
    const expand = collapsedHost.querySelector<HTMLButtonElement>("button.toolbar-collapse");
    expect(expand?.getAttribute("aria-label")).toBe(translate("board.expandToolbar"));
    expect(expand?.getAttribute("aria-expanded")).toBe("false");
    expect(expand?.querySelector("svg")?.getAttribute("class")).toContain("chevron-down");
  });
});

describe("BoardToolbar disabled states", () => {
  it("disables selection-dependent actions without a selection", async () => {
    const host = await renderToolbar(baseState);
    expect(toolbarButton(host, "board.delete")?.disabled).toBe(true);
    expect(toolbarButton(host, "board.alignLeft")?.disabled).toBe(true);
    expect(toolbarButton(host, "board.distributeX")?.disabled).toBe(true);
    expect(toolbarButton(host, "board.group")?.disabled).toBe(true);
    expect(toolbarButton(host, "board.moveTop")?.disabled).toBe(true);
    expect(toolbarButton(host, "board.cropImage")?.disabled).toBe(true);
    // 依赖白板对象的命令保持可用。
    expect(toolbarButton(host, "board.arrangeCompactSelection")?.disabled).toBe(false);
    // 与选区无关的命令保持可用。
    expect(toolbarButton(host, "board.importFiles")?.disabled).toBe(false);
  });

  it("enables align and group with two selected objects but keeps distribute locked", async () => {
    const host = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 2,
    });
    expect(toolbarButton(host, "board.alignLeft")?.disabled).toBe(false);
    expect(toolbarButton(host, "board.alignCenterY")?.disabled).toBe(false);
    expect(toolbarButton(host, "board.group")?.disabled).toBe(false);
    expect(toolbarButton(host, "board.distributeX")?.disabled).toBe(true);
    expect(toolbarButton(host, "board.delete")?.disabled).toBe(false);
  });

  it("enables distribute with three selected objects", async () => {
    const host = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 3,
    });
    expect(toolbarButton(host, "board.distributeX")?.disabled).toBe(false);
    expect(toolbarButton(host, "board.distributeY")?.disabled).toBe(false);
  });

  it("disables board-wide arrangement actions when the board has no objects", async () => {
    const host = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 1,
      hasBoardObjects: false,
    });
    expect(toolbarButton(host, "board.arrangeCompactSelection")?.disabled).toBe(true);
    expect(toolbarButton(host, "board.normalizeWidth")?.disabled).toBe(true);
    expect(toolbarButton(host, "board.normalizeHeight")?.disabled).toBe(true);
  });

  it("gates layer-step, export and note editing on the selection", async () => {
    // 无选中：上移/下移一层、导出 PNG、编辑内容全部禁用。
    const emptyHost = await renderToolbar(baseState);
    expect(toolbarButton(emptyHost, "board.moveUpOne")?.disabled).toBe(true);
    expect(toolbarButton(emptyHost, "board.moveDownOne")?.disabled).toBe(true);
    expect(toolbarButton(emptyHost, "board.exportPngSelection")?.disabled).toBe(true);
    expect(toolbarButton(emptyHost, "board.editContent")?.disabled).toBe(true);
    // 单选：上移/下移一层与导出 PNG 可用。
    const singleHost = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 1,
    });
    expect(toolbarButton(singleHost, "board.moveUpOne")?.disabled).toBe(false);
    expect(toolbarButton(singleHost, "board.moveDownOne")?.disabled).toBe(false);
    expect(toolbarButton(singleHost, "board.exportPngSelection")?.disabled).toBe(false);
  });

  it("gates content editing on the selection containing a note", async () => {
    // 单选非笔记对象：编辑内容禁用。
    const shapeHost = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 1,
      selectionHasNote: false,
    });
    expect(toolbarButton(shapeHost, "board.editContent")?.disabled).toBe(true);
    // 单选笔记/清单对象：编辑内容可用。
    const noteHost = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 1,
      selectionHasNote: true,
    });
    expect(toolbarButton(noteHost, "board.editContent")?.disabled).toBe(false);
  });

  it("gates uniform area/scale on having at least two selected objects", async () => {
    // 无选中与单选：等比面积/缩放归一禁用。
    const emptyHost = await renderToolbar(baseState);
    expect(toolbarButton(emptyHost, "board.uniformArea")?.disabled).toBe(true);
    expect(toolbarButton(emptyHost, "board.uniformScale")?.disabled).toBe(true);
    const singleHost = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 1,
    });
    expect(toolbarButton(singleHost, "board.uniformArea")?.disabled).toBe(true);
    expect(toolbarButton(singleHost, "board.uniformScale")?.disabled).toBe(true);
    // 双选：两键可用。
    const pairHost = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 2,
    });
    expect(toolbarButton(pairHost, "board.uniformArea")?.disabled).toBe(false);
    expect(toolbarButton(pairHost, "board.uniformScale")?.disabled).toBe(false);
  });

  it("keeps the inspector toggle and command palette always available", async () => {
    const host = await renderToolbar(baseState);
    expect(toolbarButton(host, "board.openInspector")?.disabled).toBe(false);
    expect(toolbarButton(host, "board.commandPaletteTitle")?.disabled).toBe(false);
    // active 态联动 inspectorOpen：开启时切换标签与高亮。
    const openHost = await renderToolbar({ ...baseState, inspectorOpen: true });
    expect(toolbarButton(openHost, "board.closeInspector")?.className).toContain("active");
  });
});
