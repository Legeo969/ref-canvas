// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  BoardColorSampleBody,
  type ColorSample,
} from "../../../../src/renderer/components/board/BoardColorSample";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function sample(overrides: Partial<ColorSample> = {}): ColorSample {
  return {
    seq: 1,
    hex: "#FF0000",
    displayHex: "#FE0101",
    alpha: 255,
    canvasPoint: { x: 10, y: 20 },
    sourcePixel: { x: 5, y: 5 },
    source: { name: "a.png", width: 100, height: 50 },
    ...overrides,
  };
}

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

async function renderSample(value: ColorSample) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <BoardColorSampleBody sample={value} />,
    );
  });
  return { host, root };
}

function hexField(host: HTMLElement) {
  return host.querySelector<HTMLElement>(".board-color-sample-swatch")?.textContent;
}

describe("BoardColorSample refresh", () => {
  it("shows the sampled hex on first render", async () => {
    const { host } = await renderSample(sample());
    expect(hexField(host)).toBe("#FF0000");
  });

  it("updates its readout when a new sample arrives", async () => {
    // 真实缺陷：内部 hsv 用 useState 初始化器承接样本，只在挂载时求值一次，
    // 再次取色只换 prop 时面板仍显示上一份读数。
    const { host, root } = await renderSample(sample());
    expect(hexField(host)).toBe("#FF0000");

    await act(async () => {
      root.render(
        <BoardColorSampleBody sample={sample({ seq: 2, hex: "#00FF00" })} />,
      );
    });
    expect(hexField(host)).toBe("#00FF00");
  });

  it("refreshes even when the same point is sampled again", async () => {
    // 同一像素重复取色：hex 与坐标都不变，只有 seq 递增。
    // 若依赖只看 hex/坐标，面板会看起来「取了没反应」。
    const { host, root } = await renderSample(sample());
    const before = hexField(host);
    await act(async () => {
      root.render(
        <BoardColorSampleBody sample={sample({ seq: 2 })} />,
      );
    });
    expect(hexField(host)).toBe(before);
    // 关键：拖动面板后（内部 hsv 被改），新样本应把读数拉回原始值。
    const plane = host.querySelector<HTMLElement>(".color-panel-plane");
    expect(plane).toBeTruthy();
    const readout = () =>
      Array.from(host.querySelectorAll("code")).map((node) => node.textContent);
    expect(readout()[0]).toBe("#FF0000");
    await act(async () => {
      root.render(
        <BoardColorSampleBody sample={sample({ seq: 3 })} />,
      );
    });
    expect(readout()[0]).toBe("#FF0000");
  });

  it("lists rgb, hsl and alpha next to the hex", async () => {
    const { host } = await renderSample(sample({ hex: "#808080", alpha: 128 }));
    const values = Array.from(host.querySelectorAll("code")).map((n) => n.textContent);
    expect(values).toContain("rgb(128, 128, 128)");
    expect(values).toContain("hsl(0, 0.0%, 50.2%)");
    expect(values).toContain("50%");
  });

  it("keeps the on-screen value collapsed and only shows it when it differs", async () => {
    // 取色就要一个值：两个值并列会让人犹豧。
    // 默认收起，且仅在与主值不同时才提供展开。
    const { host } = await renderSample(
      sample({ hex: "#FF0000", displayHex: "#FA0402" }),
    );
    const details = host.querySelector(".board-color-sample-detail");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("code")?.textContent).toBe("#FA0402");
    // 主值仍然只出现一次，不重复展示
    const codes = Array.from(host.querySelectorAll("code")).map((n) => n.textContent);
    expect(codes.filter((value) => value === "#FF0000")).toHaveLength(1);
  });

  it("hides the on-screen value entirely when the two agree", async () => {
    const { host } = await renderSample(
      sample({ hex: "#FF0000", displayHex: "#FF0000" }),
    );
    expect(host.querySelector(".board-color-sample-detail")).toBeNull();
  });

  it("hides the on-screen value when it is unavailable", async () => {
    const { host } = await renderSample(sample({ displayHex: null }));
    expect(host.querySelector(".board-color-sample-detail")).toBeNull();
  });

  it("names the sampled asset and both coordinate spaces", async () => {    const { host } = await renderSample(sample());
    // 不硬编码翻译文案（当前语言可切换），只断言内容与结构存在。
    expect(host.textContent).toContain("a.png");
    expect(host.textContent).toContain("10.0, 20.0");
    expect(host.textContent).toContain("5, 5");
    expect(host.textContent).toContain("100");
  });
});
