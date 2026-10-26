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

// 常驻层分组：无选区时可见。
const baseGroupMembers: Record<string, readonly Parameters<typeof translate>[0][]> = {
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
  history: ["board.undo", "board.redo"],
  panels: ["board.layersTitle", "board.openInspector"],
  palette: ["board.commandPaletteTitle"],
};

// 上下文层分组：仅在有选区时渲染。只放无第二入口或高频的动作。
const contextGroupMembers: Record<string, readonly Parameters<typeof translate>[0][]> = {
  transform: [
    "board.rotate90",
    "board.flipH",
    "board.flipV",
    "board.resetTransform",
  ],
  align: [
    "board.distributeX",
    "board.distributeY",
    "board.arrangeCompactSelection",
    "board.arrangeSettings",
  ],
  objects: [
    "board.toggleLock",
    "board.group",
    "board.ungroup",
    "board.cropImage",
    "board.duplicate",
    "board.commentAdd",
    "board.delete",
  ],
};

// 溢出层：收进「更多」弹层，含已有右键菜单入口的选区操作。
const overflowGroupMembers: Record<string, readonly Parameters<typeof translate>[0][]> = {
  align: [
    "board.alignLeft",
    "board.alignCenterX",
    "board.alignRight",
    "board.alignTop",
    "board.alignCenterY",
    "board.alignBottom",
    "board.normalizeWidth",
    "board.normalizeHeight",
    "board.uniformArea",
    "board.uniformScale",
  ],
  order: [
    "board.moveBottom",
    "board.moveTop",
    "board.moveUpOne",
    "board.moveDownOne",
    "board.resetCrop",
    "board.opacity",
    "board.editContent",
    "board.parentWithHint",
    "board.unparent",
  ],
  view: [
    "board.fitAll",
    "board.focusSelection",
    "board.fitSelection",
    "board.exportPngSelection",
    "board.zoom100",
  ],
  canvas: [
    "board.hideGrid",
    "board.appearanceTitle",
    "board.lockCanvasWhole",
    "board.canvasGrayscaleWhole",
    "board.gridStyleCycle",
    "board.sampleColorTitle",
  ],
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

describe("BoardToolbar layering", () => {
  it("renders only the base layer plus palette and collapse with no selection", async () => {
    const host = await renderToolbar(baseState);
    // 无选区：上下文层整体不渲染，常驻层按固定顺序出现。
    expect(renderedGroupIds(host)).toEqual([
      "file-tools",
      "add",
      "history",
      "panels",
      "palette",
      "overflow",
      "collapse",
    ]);
    expect(host.querySelector(".toolbar-layer-context")).toBeNull();
    for (const group of host.querySelectorAll<HTMLElement>(".toolbar-layer-base .toolbar-group[data-group]")) {
      const labels = Array.from(group.querySelectorAll("button")).map(
        (button) => button.getAttribute("aria-label"),
      );
      expect(labels, `group ${group.dataset.group}`).toEqual(
        baseGroupMembers[group.dataset.group as string].map((key) => translate(key)),
      );
    }
  });

  it("adds the context layer only when something is selected", async () => {
    const host = await renderToolbar({ ...baseState, hasSelection: true, selectionCount: 1 });
    const context = host.querySelector<HTMLElement>(".toolbar-layer-context");
    expect(context).not.toBeNull();
    const groups = Array.from(
      context!.querySelectorAll<HTMLElement>(".toolbar-group[data-group]"),
    );
    expect(groups.map((group) => group.dataset.group)).toEqual([
      "transform",
      "align",
      "objects",
    ]);
    for (const group of groups) {
      const labels = Array.from(group.querySelectorAll("button")).map(
        (button) => button.getAttribute("aria-label"),
      );
      expect(labels, `group ${group.dataset.group}`).toEqual(
        contextGroupMembers[group.dataset.group as string].map((key) => translate(key)),
      );
    }
  });

  it("keeps low-frequency actions inside the overflow popover", async () => {
    const host = await renderToolbar(baseState);
    // 溢出层默认不渲染，画布只有常驻层可见。
    expect(toolbarButton(host, "board.fitAll")).toBeNull();
    expect(toolbarButton(host, "board.sampleColorTitle")).toBeNull();

    const trigger = toolbarButton(host, "board.toolbarMore");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      trigger?.click();
    });
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const popover = host.querySelector(".toolbar-overflow-popover");
    expect(popover).not.toBeNull();
    for (const group of popover!.querySelectorAll<HTMLElement>(".toolbar-overflow-row")) {
      const labels = Array.from(group.querySelectorAll("button")).map(
        (button) => button.getAttribute("aria-label"),
      );
      expect(labels, `group ${group.dataset.group}`).toEqual(
        overflowGroupMembers[group.dataset.group as string].map((key) => translate(key)),
      );
    }
  });

  it("closes the overflow popover on Escape", async () => {
    const host = await renderToolbar(baseState);
    await act(async () => {
      toolbarButton(host, "board.toolbarMore")?.click();
    });
    expect(host.querySelector(".toolbar-overflow-popover")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".toolbar-overflow-popover")).toBeNull();
  });

  it("renders every action exactly once across all three layers", async () => {
    const host = await renderToolbar({ ...baseState, hasSelection: true, selectionCount: 3 });
    await act(async () => {
      toolbarButton(host, "board.toolbarMore")?.click();
    });
    const expectedLabels = [
      ...Object.values(baseGroupMembers),
      ...Object.values(contextGroupMembers),
      ...Object.values(overflowGroupMembers),
    ]
      .flat()
      .map((key) => translate(key))
      .sort();
    const chromeLabels = new Set([
      translate("board.toolbarMore"),
      translate("board.collapseToolbar"),
    ]);
    const actionLabels = Array.from(host.querySelectorAll("button"))
      .map((button) => button.getAttribute("aria-label"))
      .filter((label): label is string => label !== null && !chromeLabels.has(label))
      .sort();
    expect(actionLabels).toEqual(expectedLabels);
  });

  it("keeps all three layers within a single toolbar row at 1490px", async () => {
    // 验收标准之一：默认状态单行。之前的真实缺陷是 67 个按钮平铺需要
    // 约 2375px，在 1490px 的画布宽度下必然换行成参差两行。这里直接把
    // 各层键数换算成像素宽度作硬约束，改分组时宽度回归会立刻失败。
    const BUTTON = 35; // 34px + 1px gap
    const GROUP_SEP = 6;
    const AVAILABLE = 1490; // 1920 窗口 − 侧栏/面板
    const widthOf = (groups: Record<string, readonly unknown[]>) => {
      const keys = Object.values(groups).reduce((sum, list) => sum + list.length, 0);
      return keys * BUTTON + (Object.keys(groups).length - 1) * GROUP_SEP;
    };
    // 选中时三层同时可见，是最大宽度状态；再加溢出触发与收起两个按钮。
    const total =
      widthOf(baseGroupMembers) + widthOf(contextGroupMembers) + 2 * BUTTON;
    expect(total).toBeLessThan(AVAILABLE);
    expect(widthOf(overflowGroupMembers)).toBeLessThan(AVAILABLE);
  });

  it("gives every action a distinct icon so glyphs never mean two things", async () => {
    // 旧版的真实缺陷：ChevronDown 同时是绘图设置/下移一层/排列设置，
    // Square 同时是添加矩形/矩形蒙版。同一个图形承担两个语义，只能靠
    // hover 分清——这里是硬约束，不是视觉偏好。
    const host = await renderToolbar({ ...baseState, hasSelection: true, selectionCount: 3 });
    await act(async () => {
      toolbarButton(host, "board.toolbarMore")?.click();
    });
    const chrome = new Set([
      translate("board.toolbarMore"),
      translate("board.collapseToolbar"),
    ]);
    const labelByGlyph = new Map<string, string>();
    for (const button of host.querySelectorAll<HTMLButtonElement>("button[aria-label]")) {
      const label = button.getAttribute("aria-label") as string;
      if (chrome.has(label)) continue;
      // 图标按钮取 svg 内容，文字工具取 span 文本；两种都作字形指纹。
      const glyph =
        button.querySelector("svg")?.innerHTML ??
        button.querySelector("span.text-tool-icon")?.textContent ??
        "";
      const previous = labelByGlyph.get(glyph);
      expect(previous, `「${label}」与「${previous}」共用了同一个图标`).toBeUndefined();
      labelByGlyph.set(glyph, label);
    }
  });

  it("keeps every action label unique so tooltips never collide", async () => {
    // 同一工具条里两个按钮同名会让 hover 提示和 aria 查询都失去区分度。
    const host = await renderToolbar({ ...baseState, hasSelection: true, selectionCount: 3 });
    await act(async () => {
      toolbarButton(host, "board.toolbarMore")?.click();
    });
    const labels = Array.from(host.querySelectorAll("button[aria-label]"))
      .map((button) => button.getAttribute("aria-label") as string);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("collapses to the core row and drops the context layer", async () => {
    const host = await renderToolbar({
      ...baseState,
      toolbarCollapsed: true,
      hasSelection: true,
      selectionCount: 2,
    });
    // 收起态：只留 file-tools + palette + 收起开关，上下文层与溢出菜单都不出现。
    expect(renderedGroupIds(host)).toEqual(["file-tools", "palette", "collapse"]);
    expect(host.querySelector(".toolbar-layer-context")).toBeNull();
    expect(host.querySelector(".toolbar-overflow")).toBeNull();
    expect(toolbarButton(host, "board.addText")).toBeNull();
    expect(toolbarButton(host, "board.importFiles")?.disabled).toBe(false);
  });

  it("flips the collapse toggle between collapse and expand affordances", async () => {
    const onCommand = vi.fn();
    const expandedHost = await renderToolbar(baseState, onCommand);
    const collapse = expandedHost.querySelector<HTMLButtonElement>("button.toolbar-collapse");
    expect(collapse?.getAttribute("aria-label")).toBe(translate("board.collapseToolbar"));
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      collapse?.click();
    });
    expect(onCommand).toHaveBeenCalledWith("toggleToolbarCollapsed");

    const collapsedHost = await renderToolbar({ ...baseState, toolbarCollapsed: true });
    const expand = collapsedHost.querySelector<HTMLButtonElement>("button.toolbar-collapse");
    expect(expand?.getAttribute("aria-label")).toBe(translate("board.expandToolbar"));
    expect(expand?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("BoardToolbar disabled states", () => {
  it("disables selection-dependent actions without a selection", async () => {
    const host = await renderToolbar(baseState);
    // 上下文层未渲染，依赖选区的命令自然不在 DOM 里。
    expect(toolbarButton(host, "board.delete")).toBeNull();
    expect(toolbarButton(host, "board.alignLeft")).toBeNull();
    expect(toolbarButton(host, "board.moveTop")).toBeNull();
    expect(toolbarButton(host, "board.importFiles")?.disabled).toBe(false);
  });

  it("disables pair and distribute actions by selection size", async () => {
    const single = await renderToolbar({ ...baseState, hasSelection: true, selectionCount: 1 });
    expect(toolbarButton(single, "board.group")?.disabled).toBe(true);
    expect(toolbarButton(single, "board.delete")?.disabled).toBe(false);
    // 对齐 6 项在溢出层：先开弹层再断言。
    await act(async () => {
      toolbarButton(single, "board.toolbarMore")?.click();
    });
    expect(toolbarButton(single, "board.alignLeft")?.disabled).toBe(true);

    const pair = await renderToolbar({ ...baseState, hasSelection: true, selectionCount: 2 });
    expect(toolbarButton(pair, "board.group")?.disabled).toBe(false);
    expect(toolbarButton(pair, "board.distributeX")?.disabled).toBe(true);
    await act(async () => {
      toolbarButton(pair, "board.toolbarMore")?.click();
    });
    expect(toolbarButton(pair, "board.alignLeft")?.disabled).toBe(false);

    const triple = await renderToolbar({ ...baseState, hasSelection: true, selectionCount: 3 });
    expect(toolbarButton(triple, "board.distributeX")?.disabled).toBe(false);
  });

  it("disables board-wide arrangement actions when the board has no objects", async () => {
    const host = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 1,
      hasBoardObjects: false,
    });
    expect(toolbarButton(host, "board.arrangeCompactSelection")?.disabled).toBe(true);
    await act(async () => {
      toolbarButton(host, "board.toolbarMore")?.click();
    });
    expect(toolbarButton(host, "board.normalizeWidth")?.disabled).toBe(true);
  });

  it("gates content editing on the selection containing a note", async () => {
    const shape = await renderToolbar({ ...baseState, hasSelection: true, selectionCount: 1 });
    const note = await renderToolbar({
      ...baseState,
      hasSelection: true,
      selectionCount: 1,
      selectionHasNote: true,
    });
    // 编辑内容在溢出层：两实例分别开弹层。
    await act(async () => {
      toolbarButton(shape, "board.toolbarMore")?.click();
      toolbarButton(note, "board.toolbarMore")?.click();
    });
    expect(toolbarButton(shape, "board.editContent")?.disabled).toBe(true);
    expect(toolbarButton(note, "board.editContent")?.disabled).toBe(false);
  });

  it("gates export PNG on having a selection", async () => {
    const empty = await renderToolbar(baseState);
    await act(async () => {
      toolbarButton(empty, "board.toolbarMore")?.click();
    });
    expect(toolbarButton(empty, "board.exportPngSelection")?.disabled).toBe(true);

    const single = await renderToolbar({ ...baseState, hasSelection: true, selectionCount: 1 });
    await act(async () => {
      toolbarButton(single, "board.toolbarMore")?.click();
    });
    expect(toolbarButton(single, "board.exportPngSelection")?.disabled).toBe(false);
  });

  it("keeps the inspector toggle active state in sync", async () => {
    const host = await renderToolbar({ ...baseState, inspectorOpen: true });
    expect(toolbarButton(host, "board.closeInspector")?.className).toContain("active");
  });
});
