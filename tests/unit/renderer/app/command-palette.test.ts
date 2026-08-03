import { describe, expect, it } from "vitest";
import {
  rankCommandItems,
  recordRecentCommand,
  type CommandSearchItem,
} from "../../../../src/renderer/app/command-palette";

const commands: CommandSearchItem[] = [
  {
    id: "fit-all",
    label: "适应全部对象",
    group: "视图",
    shortcut: "Ctrl+0",
    keywords: ["fit all"],
  },
  {
    id: "fit-selection",
    label: "适应选区",
    group: "视图",
    shortcut: "Ctrl+Shift+0",
    keywords: ["fit selection"],
  },
  {
    id: "align-left",
    label: "左对齐",
    group: "排列",
    keywords: ["align left"],
  },
];

describe("rankCommandItems", () => {
  it("prioritizes exact labels and searches Chinese, groups and English aliases", () => {
    expect(rankCommandItems(commands, "适应选区").map((item) => item.id)).toEqual([
      "fit-selection",
    ]);
    expect(rankCommandItems(commands, "视图 fit").map((item) => item.id)).toEqual([
      "fit-all",
      "fit-selection",
    ]);
    expect(rankCommandItems(commands, "align left").map((item) => item.id)).toEqual([
      "align-left",
    ]);
  });

  it("places recent commands first when the query is empty", () => {
    expect(
      rankCommandItems(commands, "", ["align-left", "fit-all"]).map(
        (item) => item.id,
      ),
    ).toEqual(["align-left", "fit-all", "fit-selection"]);
  });
});

describe("recordRecentCommand", () => {
  it("deduplicates, moves the latest command to the front and applies the limit", () => {
    expect(recordRecentCommand(["b", "a", "c"], "a", 3)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(recordRecentCommand(["b", "c", "d"], "a", 3)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
