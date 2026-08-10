import { describe, expect, it } from "vitest";
import { workspaceStatusHint } from "../../../../src/renderer/app/workspace-status";
import { setLanguage } from "../../../../src/renderer/app/i18n";

describe("workspaceStatusHint", () => {
  it("describes only shortcuts that belong to the active workspace", () => {
    setLanguage("zh-CN");
    expect(workspaceStatusHint("directory")).toContain("F 收藏");
    expect(workspaceStatusHint("directory")).toContain("0–5 评分");
    expect(workspaceStatusHint("board")).toContain("↑/↓ 调整层级");
    expect(workspaceStatusHint("board", "standard")).toContain("方向键移动选中");
    expect(workspaceStatusHint("board", "standard")).toContain("F 适应选区");
    expect(workspaceStatusHint("board")).not.toContain("评分");
  });

  it("follows the global interface language", () => {
    setLanguage("en");
    expect(workspaceStatusHint("directory")).toContain("Arrow keys browse");
    expect(workspaceStatusHint("board", "standard")).toContain("F fit selection");
  });
});
