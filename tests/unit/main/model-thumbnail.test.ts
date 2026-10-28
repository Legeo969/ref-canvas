import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { renderObjThumbnail } from "../../../src/main/services/media/model-thumbnail";

/**
 * OBJ 缩略图的朝向回归：世界坐标 +Y 必须映射到屏幕上方。
 * 投影函数若直接用 y（而不是 -y），模型整体倒立——头朝下、脚朝上。
 */
describe("renderObjThumbnail orientation", () => {
  let scratch: string | null = null;

  afterEach(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = null;
  });

  /** 单向上扬的楔形：只有 +Y 一端有体积，投影后上下分布必然不对称。 */
  function buildWedgeObj(): string {
    const lines: string[] = [];
    // 底部宽、顶部窄的棱台：底部 4 顶点在 y=0，顶部缩成一个点 y=6。
    lines.push("v -2 0 -2", "v 2 0 -2", "v 2 0 2", "v -2 0 2");
    lines.push("v 0 6 0");
    lines.push("f 1 3 2", "f 1 4 3", "f 1 2 5", "f 2 3 5", "f 3 4 5", "f 4 1 5");
    return `${lines.join("\n")}\n`;
  }

  async function renderWedge(width = 200, height = 200) {
    scratch = await mkdtemp(path.join(tmpdir(), "refcanvas-obj-"));
    const source = path.join(scratch, "wedge.obj");
    await writeFile(source, buildWedgeObj(), "utf8");
    const output = path.join(scratch, "wedge.webp");
    await renderObjThumbnail(source, output, width, height);
    // 用 toBuffer 而非文件句柄读像素：避免 Windows 上文件仍被占用（EBUSY）。
    const { data, info } = await sharp(await readFile(output))
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, info };
  }

  const BACKGROUND = { r: 32, g: 36, b: 35 };
  const isPainted = (data: Buffer, offset: number) =>
    Math.abs(data[offset] - BACKGROUND.r) > 12 ||
    Math.abs(data[offset + 1] - BACKGROUND.g) > 12 ||
    Math.abs(data[offset + 2] - BACKGROUND.b) > 12;

  it("puts the sharp end (+Y) toward the top of the image", async () => {
    const { data, info } = await renderWedge();

    // 楔形上窄下宽：越靠顶部，每行绘制像素越少。若上下颠倒，趋势会反过来。
    const rowWidths: number[] = [];
    for (let y = 0; y < info.height; y++) {
      let count = 0;
      for (let x = 0; x < info.width; x++) {
        if (isPainted(data, (y * info.width + x) * info.channels)) count++;
      }
      rowWidths.push(count);
    }
    const paintedRows = rowWidths.filter((count) => count > 0);
    expect(paintedRows.length).toBeGreaterThan(10);
    const firstQuarter = rowWidths.slice(0, Math.floor(info.height / 4));
    const lastQuarter = rowWidths.slice(Math.floor((info.height * 3) / 4));
    const topWidth = firstQuarter.reduce((sum, value) => sum + value, 0) / Math.max(1, firstQuarter.filter(Boolean).length);
    const bottomWidth = lastQuarter.reduce((sum, value) => sum + value, 0) / Math.max(1, lastQuarter.filter(Boolean).length);
    expect(bottomWidth).toBeGreaterThan(topWidth * 1.5);
  });

  it("keeps the rendered geometry inside the canvas", async () => {
    const { data, info } = await renderWedge();
    let painted = 0;
    let edgePainted = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (!isPainted(data, (y * info.width + x) * info.channels)) continue;
        painted++;
        if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
          edgePainted++;
        }
      }
    }
    expect(painted).toBeGreaterThan(0);
    // 0.78 的边距保证模型不贴边。
    expect(edgePainted / painted).toBeLessThan(0.02);
  });
});
