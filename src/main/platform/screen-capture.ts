import { desktopCapturer, type Display } from "electron";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 屏幕抓取后端。
 *
 * 旧实现每次截图都走 desktopCapturer.getSources({ types: ["screen"] }) 并
 * 给缩略图请求全屏物理像素尺寸：Electron 会把**每一块**显示器都编码成 PNG，
 * 再经 nativeImage.toDataURL() 序列化成十几 MB 的 base64 字符串穿过 IPC。
 * 同机实测 1080p 单屏 350–500ms，是点击后卡顿的主要来源。
 *
 * 这里换成 node-screenshots（napi-rs 绑定 XCap，直接调系统抓屏 API）：同机
 * 实测 25–30ms，且只抓目标那一块屏。结果落临时 PNG 文件，渲染端经
 * refbrowse:// token 读取——关键路径上没有 base64。
 *
 * 原生绑定不可用（非 win/mac/linux、架构不支持、.node 未 unpack、用户显式
 * 禁用）时整体回退到 desktopCapturer：功能不变，只是慢。
 */

/** 抓屏结果的落盘形态：只有文件路径，不携带图像字节。 */
export interface DisplayCapture {
  filePath: string;
  /** 物理像素宽高（= 显示逻辑尺寸 × scaleFactor）。 */
  width: number;
  height: number;
  backend: "native" | "electron";
}

/** 显示器几何信息（物理/逻辑均可，由 pickMonitor 两种口径各算一次）。 */
export interface CaptureMonitorInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

interface NativeImage {
  width: number;
  height: number;
  toPng(copyOutputData?: boolean | null): Promise<Buffer>;
}

/** node-screenshots 的 Monitor：几何量是方法而不是属性。 */
interface NativeMonitor {
  id(): number;
  x(): number;
  y(): number;
  width(): number;
  height(): number;
  scaleFactor(): number;
  captureImage(): Promise<NativeImage>;
}

/** 把原生 Monitor 摊平成 pickMonitor 需要的纯几何快照。 */
function toMonitorInfo(monitor: NativeMonitor): CaptureMonitorInfo & {
  captureImage(): Promise<NativeImage>;
} {
  return {
    x: monitor.x(),
    y: monitor.y(),
    width: monitor.width(),
    height: monitor.height(),
    scaleFactor: monitor.scaleFactor(),
    captureImage: () => monitor.captureImage(),
  };
}

export interface NativeScreenshotsModule {
  Monitor: { all(): NativeMonitor[] };
}

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 在 xcap 的显示器列表里找出 Electron 认定的那块屏。
 *
 * 坐标系不确定是这里唯一的难点：xcap 在某些平台把 x/y/width/height 报成
 * 逻辑像素（DIP），在另一些平台报成物理像素，而 Windows 混合 DPI 下第二块
 * 屏的物理偏移并不等于 DIP 偏移 × 自身缩放，所以"按重叠面积猜"会在
 * 双屏不同缩放时选错屏。
 *
 * 因此这里只认**可验证的相等**：先在两种解释下找几何完全一致的显示器
 * （容差 2px）；都找不到时，退一步只接受"尺寸唯一匹配"——即恰好一块屏的
 * 尺寸对得上，其余屏尺寸都不同。任何仍然模棱两可的情况返回 null，让调用方
 * 回落 desktopCapturer（它用 display_id 精确匹配，只是慢），绝不截错屏。
 */
export function pickMonitor<T extends CaptureMonitorInfo>(
  monitors: readonly T[],
  bounds: DisplayBounds,
  scaleFactor: number,
): T | null {
  if (monitors.length === 0) return null;
  const physical: DisplayBounds = {
    x: Math.round(bounds.x * scaleFactor),
    y: Math.round(bounds.y * scaleFactor),
    width: Math.round(bounds.width * scaleFactor),
    height: Math.round(bounds.height * scaleFactor),
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  const sameGeometry = (monitor: CaptureMonitorInfo, target: DisplayBounds) =>
    near(monitor.x, target.x) &&
    near(monitor.y, target.y) &&
    near(monitor.width, target.width) &&
    near(monitor.height, target.height);
  const sameSize = (monitor: CaptureMonitorInfo, target: DisplayBounds) =>
    near(monitor.width, target.width) && near(monitor.height, target.height);

  const exact = monitors.filter(
    (monitor) => sameGeometry(monitor, bounds) || sameGeometry(monitor, physical),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    // 复制/镜像模式下两块屏几何完全一致：用 scaleFactor 分出唯一的那块。
    const scaled = exact.filter(
      (monitor) => Math.abs(monitor.scaleFactor - scaleFactor) < 0.01,
    );
    return scaled.length === 1 ? scaled[0] : null;
  }

  const bySize = monitors.filter(
    (monitor) => sameSize(monitor, bounds) || sameSize(monitor, physical),
  );
  return bySize.length === 1 ? bySize[0] : null;
}

/** 抓屏临时目录：单槽复用，永不进入资料库索引。 */
export function captureCacheDirectory(userDataPath: string): string {
  return path.join(userDataPath, "capture-cache");
}

let sequence = 0;

/**
 * 写一个"当前"截图到临时槽位并返回路径。
 *
 * 每次用新文件名而不是覆盖同名文件：refbrowse:// 的 token 按路径签发，
 * 同名路径会命中 Chromium 的图像缓存，第二次截图仍显示上一张。
 */
async function writeCaptureSlot(
  directory: string,
  png: Buffer,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  sequence += 1;
  const filename = path.join(directory, `current-${sequence}.png`);
  await writeFile(filename, png);
  return filename;
}

/** 删掉上一次的临时截图（保存/取消/新建前调用）。 */
export async function discardCapture(filePath: string | null): Promise<void> {
  if (!filePath) return;
  await rm(filePath, { force: true }).catch(() => undefined);
}

const NATIVE_DISABLED_ENV = "REFCANVAS_DISABLE_NATIVE_CAPTURE";

/** 一个进程只探测一次原生绑定：装了但加载失败就当永久不可用。 */
let nativeModulePromise: Promise<NativeScreenshotsModule | null> | null = null;

function loadNativeModule(): Promise<NativeScreenshotsModule | null> {
  if (nativeModulePromise) return nativeModulePromise;
  nativeModulePromise = (async () => {
    if (process.env[NATIVE_DISABLED_ENV] === "1") return null;
    try {
      const loaded = (await import("node-screenshots")) as unknown as {
        Monitor?: NativeScreenshotsModule["Monitor"];
      };
      if (!loaded?.Monitor || typeof loaded.Monitor.all !== "function") return null;
      return { Monitor: loaded.Monitor };
    } catch (error) {
      console.warn("[capture] native backend unavailable:", error);
      return null;
    }
  })();
  return nativeModulePromise;
}

async function captureWithNative(
  directory: string,
  display: Display,
  nativeModule: NativeScreenshotsModule,
): Promise<DisplayCapture> {
  const monitor = pickMonitor(
    nativeModule.Monitor.all().map(toMonitorInfo),
    display.bounds,
    display.scaleFactor,
  );
  if (!monitor) throw new Error("SCREEN_CAPTURE_UNAVAILABLE");
  const image = await monitor.captureImage();
  if (image.width <= 0 || image.height <= 0) {
    throw new Error("SCREEN_CAPTURE_UNAVAILABLE");
  }
  // copyOutputData 必须显式传 true：Electron 下 napi 不复制输出缓冲会崩溃
  // （napi-rs/napi-rs#1346，库 README 明写）。
  const png = await image.toPng(true);
  const filePath = await writeCaptureSlot(directory, png);
  return {
    filePath,
    width: image.width,
    height: image.height,
    backend: "native",
  };
}

async function captureWithDesktopCapturer(
  directory: string,
  display: Display,
): Promise<DisplayCapture> {
  const width = Math.round(display.size.width * display.scaleFactor);
  const height = Math.round(display.size.height * display.scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  const source =
    sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("SCREEN_CAPTURE_UNAVAILABLE");
  }
  const size = source.thumbnail.getSize();
  const png = source.thumbnail.toPNG();
  if (png.byteLength === 0) throw new Error("SCREEN_CAPTURE_UNAVAILABLE");
  const filePath = await writeCaptureSlot(directory, png);
  return { filePath, width: size.width, height: size.height, backend: "electron" };
}

/**
 * 抓一块屏到临时文件。原生后端失败时自动降级，两个后端都不行才抛错。
 */
export async function captureDisplay(
  directory: string,
  display: Display,
): Promise<DisplayCapture> {
  const nativeModule = await loadNativeModule();
  if (nativeModule) {
    try {
      return await captureWithNative(directory, display, nativeModule);
    } catch (error) {
      console.warn("[capture] native capture failed, falling back:", error);
    }
  }
  return captureWithDesktopCapturer(directory, display);
}