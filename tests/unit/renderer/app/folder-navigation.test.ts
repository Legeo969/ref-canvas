import { describe, expect, it } from "vitest";
import type { CollectionRecord } from "../../../../src/shared/contracts";
import {
  ancestorChain,
  directoryBreadcrumb,
  folderLabel,
} from "../../../../src/renderer/app/folder-navigation";

function folder(
  id: string,
  title: string,
  parentId: string | null = null,
): CollectionRecord {
  return {
    id,
    title,
    parentId,
    sortOrder: 0,
    directAssetCount: 0,
    assetCount: 0,
    locked: false,
    createdAt: "",
  };
}

const tree = [
  folder("a", "A"),
  folder("b", "B", "a"),
  folder("c", "C", "b"),
  folder("d", "D", "a"),
];

describe("ancestorChain", () => {
  it("返回从根到自身的有序祖先链", () => {
    expect(ancestorChain(tree, "c").map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("根文件夹只包含自身", () => {
    expect(ancestorChain(tree, "a").map((item) => item.id)).toEqual(["a"]);
  });

  it("null 与未知 id 返回空数组", () => {
    expect(ancestorChain(tree, null)).toEqual([]);
    expect(ancestorChain(tree, "missing")).toEqual([]);
  });

  it("数据环（异常场景）不会死循环或重复", () => {
    const cyclic = [
      folder("x", "X"),
      folder("y", "Y", "x"),
      folder("z", "Z", "y"),
      { ...folder("x2", "X2", "z"), id: "x" },
    ];
    const chain = ancestorChain(cyclic, "x");
    expect(chain.length).toBeLessThanOrEqual(cyclic.length);
    expect(new Set(chain.map((item) => item.id)).size).toBe(chain.length);
  });
});

describe("folderLabel", () => {
  it("拼出完整路径标签", () => {
    expect(folderLabel(tree, "c")).toBe("A / B / C");
  });

  it("根文件夹只有自身标题", () => {
    expect(folderLabel(tree, "a")).toBe("A");
  });
});

describe("directoryBreadcrumb", () => {
  it("盘符路径分段且每段给出可跳转路径", () => {
    const crumbs = directoryBreadcrumb("C:\\refs\\shots\\day1");
    expect(crumbs.map((crumb) => crumb.label)).toEqual([
      "C:",
      "refs",
      "shots",
      "day1",
    ]);
    expect(crumbs[0].path).toBe("C:\\");
    expect(crumbs[1].path).toBe("C:\\refs");
    expect(crumbs[2].path).toBe("C:\\refs\\shots");
    expect(crumbs[3].path).toBe("C:\\refs\\shots\\day1");
  });

  it("反斜杠与正斜杠混合输入归一化", () => {
    expect(directoryBreadcrumb("D:/a/b").map((crumb) => crumb.label)).toEqual([
      "D:",
      "a",
      "b",
    ]);
  });

  it("UNC 前缀保留双反斜杠根", () => {
    const crumbs = directoryBreadcrumb("\\\\nas\\share\\art");
    expect(crumbs[0].path).toBe("\\\\nas\\share");
    expect(crumbs[1].path).toBe("\\\\nas\\share\\art");
  });

  it("null 与空路径返回空数组", () => {
    expect(directoryBreadcrumb(null)).toEqual([]);
    expect(directoryBreadcrumb("")).toEqual([]);
  });
});
