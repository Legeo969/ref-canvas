import { FolderOpen, ImageOff, ImagePlus, LoaderCircle, Save, Settings2, Sparkles, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import type {
  ReferenceMatchAnalysis,
  ReferenceMatchControls,
  ReferenceMatchHueFamily,
  ReferenceMatchResult,
  ReferenceMatchSlog3Gamut,
  ReferenceMatchSlog3Range,
  ReferenceMatchWorkspace,
} from "../../shared/contracts";
import { translate } from "../app/i18n";
import { DIRECTORY_ENTRY_MIME } from "./DirectoryAssetPanel";
import { ReferenceScopes } from "./ReferenceScopes";
import { SelectMenu } from "./SelectMenu";

/** 与主进程 `DEFAULT_LOOK_CONTROLS` 保持一致的初始观感。 */
const DEFAULT_CONTROLS: ReferenceMatchControls = {
  matchStrength: 90,
  shadows: 100,
  midtones: 100,
  highlights: 100,
  protectSkin: true,
  protectSaturation: true,
  protectContrast: true,
};

/** 滑杆连续拖动时的合并窗口：既跟手，又不会把主进程打成队列。 */
const MATCH_DEBOUNCE_MS = 160;

const HUE_KEYS: Record<ReferenceMatchHueFamily, Parameters<typeof translate>[0]> = {
  neutral: "preview.matchHueNeutral",
  "warm-red": "preview.matchHueWarmRed",
  "warm-orange": "preview.matchHueWarmOrange",
  "warm-yellow": "preview.matchHueWarmYellow",
  "yellow-green": "preview.matchHueYellowGreen",
  "natural-green": "preview.matchHueNaturalGreen",
  "cool-cyan": "preview.matchHueCoolCyan",
  "cool-blue": "preview.matchHueCoolBlue",
  "cool-violet": "preview.matchHueCoolViolet",
  magenta: "preview.matchHueMagenta",
  rose: "preview.matchHueRose",
};

function fileNameOf(filename: string): string {
  return filename.split(/[\\/]/).pop() || filename;
}

function stemOf(filename: string): string {
  return fileNameOf(filename).replace(/\.[^.]*$/, "") || "reference-match";
}

function isDpxPath(filename: string): boolean {
  return /\.dpx$/i.test(filename);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 把主进程错误码折成一句能读懂的话，未知错误原样透出。 */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("REFERENCE_MATCH_REFERENCE_UNAVAILABLE")) return translate("preview.matchReferenceUnavailable");
  if (message.includes("REFERENCE_MATCH_SOURCE_UNAVAILABLE")) return translate("preview.matchSourceUnavailable");
  if (message.includes("REFERENCE_MATCH_CONTROLS_INVALID")) return translate("preview.matchControlsInvalid");
  if (message.includes("REFERENCE_MATCH_LUT_MISSING")) return translate("preview.matchLutMissing");
  if (message.includes("REFERENCE_MATCH_PREVIEW_MISSING")) return translate("preview.matchLutMissing");
  if (message.includes("THUMBNAIL_CACHE_UNAVAILABLE")) return translate("preview.matchCacheUnavailable");
  if (message.includes("REFERENCE_MATCH_TARGET_MISSING")) return translate("preview.matchTargetMissing");
  if (message.includes("REFERENCE_MATCH_REFERENCE_DPX_UNSUPPORTED")) return translate("preview.matchReferenceDpx");
  if (message.includes("REFERENCE_MATCH_DPX_REQUIRES_WORKSPACE")) return translate("preview.matchDpxNeedsWorkspace");
  if (message.includes("REFERENCE_MATCH_SLOG3_REQUIRES_DPX")) return translate("preview.matchSlog3NeedsDpx");
  if (message.includes("REFERENCE_MATCH_LIBRARY_EXISTS")) return translate("preview.matchLibraryExists");
  if (message.includes("REFERENCE_MATCH_LIBRARY_DIRECTORY_MISSING")) return translate("preview.matchLibraryMissing");
  return message;
}

const WORKSPACE_OPTIONS: { value: ReferenceMatchWorkspace; labelKey: Parameters<typeof translate>[0] }[] = [
  { value: "rec709", labelKey: "preview.matchWorkspaceRec709" },
  { value: "dwg", labelKey: "preview.matchWorkspaceDwg" },
  { value: "slog3", labelKey: "preview.matchWorkspaceSlog3" },
];

export function ReferenceMatchStudio({
  sourcePath,
  onChangeSource,
}: {
  /** 源画面：位图，或 DWG/DI、原生 S-Log3 的 DPX 静帧。 */
  sourcePath: string;
  /** 在工作区里换一张源画面（可选）。 */
  onChangeSource?: () => void;
}) {
  const [referencePath, setReferencePath] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ReferenceMatchAnalysis | null>(null);
  const [controls, setControls] = useState<ReferenceMatchControls>(DEFAULT_CONTROLS);
  const [dimension, setDimension] = useState<33 | 65>(33);
  const [workspace, setWorkspace] = useState<ReferenceMatchWorkspace>("rec709");
  const [slog3Gamut, setSlog3Gamut] = useState<ReferenceMatchSlog3Gamut>("sgamut3-cine");
  const [slog3Range, setSlog3Range] = useState<ReferenceMatchSlog3Range>("full");
  const [result, setResult] = useState<ReferenceMatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [divider, setDivider] = useState(50);
  const [dragOver, setDragOver] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outputDirectory, setOutputDirectory] = useState<string>("");
  const [resolveLutDirectory, setResolveLutDirectory] = useState<string>("");
  const [compensation, setCompensation] = useState(true);
  const compareRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 设置只在打开设置区时读一次，避免每次渲染都过 IPC。
  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    void window.refCanvas.media
      .matchSettings()
      .then((settings) => {
        if (cancelled) return;
        setOutputDirectory(settings.outputDirectory);
        setResolveLutDirectory(settings.resolveLutDirectory);
        setCompensation(settings.resolveOutputCompensation);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  // 参考图一变就重新做风格摘要；摘要失败不阻断匹配（只是一块读数缺失）。
  useEffect(() => {
    if (!referencePath) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    setAnalysing(true);
    void window.refCanvas.media
      .matchAnalysis(referencePath)
      .then((next) => {
        if (cancelled) return;
        setAnalysis(next);
      })
      .catch(() => {
        if (!cancelled) setAnalysis(null);
      })
      .finally(() => {
        if (!cancelled) setAnalysing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [referencePath]);

  const sourceIsDpx = isDpxPath(sourcePath);
  const slog3NeedsDpx = workspace === "slog3" && !sourceIsDpx;
  const rec709RejectsDpx = workspace === "rec709" && sourceIsDpx;
  const workspaceBlocked = slog3NeedsDpx || rec709RejectsDpx;

  const runMatch = useCallback(async () => {
    if (!referencePath || workspaceBlocked) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy(true);
    setError(null);
    try {
      const next = await window.refCanvas.media.matchCreate({
        sourcePath: sourcePath,
        referencePath,
        timeMs: 0,
        controls,
        dimension,
        workspace,
        slog3Gamut,
        slog3InputRange: slog3Range,
        // 面板最宽也就一千二三，1280 已超过 1x 屏所需；再大只是白白
        // 拉长每次拖杆的渲染时间。
        previewSize: 1280,
      });
      // 慢请求可能晚于新请求返回，旧结果不得覆盖新结果。
      if (!mountedRef.current || requestRef.current !== requestId) return;
      setResult(next);
      // 参数一变，之前导出的 LUT 就不再代表当前配方，“已应用”的提示
      // 必须跟着失效，否则用户会以为画面用的是新参数。
      setApplied(false);
    } catch (caught) {
      if (!mountedRef.current || requestRef.current !== requestId) return;
      setError(describeError(caught));
      setResult(null);
    } finally {
      if (mountedRef.current && requestRef.current === requestId) setBusy(false);
    }
  }, [
    sourcePath,
    controls,
    dimension,
    referencePath,
    slog3Gamut,
    slog3Range,
    workspace,
    workspaceBlocked,
  ]);

  useEffect(() => {
    if (!referencePath || workspaceBlocked) {
      if (!referencePath) setResult(null);
      return;
    }
    const timer = setTimeout(() => void runMatch(), MATCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [referencePath, runMatch, workspaceBlocked]);

  /** 选图与拖放共用一条入口：重置对比位置与上一条导出结果。 */
  const acceptReference = useCallback((filename: string) => {
    setReferencePath(filename);
    setDivider(50);
    setExportedPath(null);
    setError(null);
    setNotice(null);
  }, []);

  const pickReference = async () => {
    const [filename] = await window.refCanvas.system.pickFile({
      title: translate("preview.matchPickReference"),
      multiSelections: false,
      filters: [{ name: "Image", extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "avif"] }],
    });
    if (filename) acceptReference(filename);
  };

  const dropReference = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    const transfer = event.dataTransfer;
    // 两条来源：应用自己网格里的拖拽只带自定义 MIME，没有 File 对象；
    // 从资源管理器拖进来才有 files。只认 files 会让“从右边拖一张图过来”
    // 静默失败。
    const internal = transfer.getData(DIRECTORY_ENTRY_MIME);
    if (internal) {
      try {
        const payload = JSON.parse(internal) as { path?: string; isDirectory?: boolean };
        if (payload.path && !payload.isDirectory) {
          acceptReference(payload.path);
          return;
        }
      } catch {
        // 载荷不是预期结构就当外部文件处理。
      }
    }
    const files = Array.from(transfer.files);
    const [filename] = files.length ? window.refCanvas.library.pathsForFiles(files) : [];
    if (filename) acceptReference(filename);
  };

  /** 整个面板都是投放区：用户不会先瞄准那一小块对比框。 */
  const dragProps = {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      // 不声明 copy，部分来源（应用内部拖拽）会在松手时被判定为不允许。
      event.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
      // 子元素之间移动也会触发 dragleave，只有真正离开面板才收起高亮。
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDragOver(false);
    },
    onDrop: dropReference,
  };

  const exportLut = async () => {
    if (!result) return;
    const directory = await window.refCanvas.system.pickDirectory({
      title: translate("preview.matchPickDirectory"),
    });
    if (!directory) return;
    setExporting(true);
    setError(null);
    try {
      const saved = await window.refCanvas.media.exportMatchLut({
        lutPath: result.lutPath,
        targetDirectory: directory,
        baseName: `${stemOf(sourcePath)}-match`,
      });
      if (mountedRef.current) setExportedPath(saved.path);
    } catch (caught) {
      if (mountedRef.current) setError(describeError(caught));
    } finally {
      if (mountedRef.current) setExporting(false);
    }
  };

  const exportPng = async () => {
    if (!result) return;
    const directory = await window.refCanvas.system.pickDirectory({
      title: translate("preview.matchPickDirectory"),
    });
    if (!directory) return;
    setExportingPng(true);
    setError(null);
    try {
      const saved = await window.refCanvas.media.exportMatchPng({
        previewPath: result.previewPath,
        targetDirectory: directory,
        baseName: `${stemOf(sourcePath)}-match-preview`,
      });
      if (mountedRef.current) setNotice(translate("preview.matchPngSaved").replace("{path}", saved.path));
    } catch (caught) {
      if (mountedRef.current) setError(describeError(caught));
    } finally {
      if (mountedRef.current) setExportingPng(false);
    }
  };

  const importToLibrary = async () => {
    if (!result) return;
    setLibraryBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await window.refCanvas.media.importMatchLutToLibrary({
        lutPath: result.lutPath,
        name: `${stemOf(sourcePath)}-${result.workspace}`,
      });
      if (mountedRef.current) {
        setNotice(translate("preview.matchLibraryImported").replace("{path}", saved.path));
      }
    } catch (caught) {
      if (mountedRef.current) setError(describeError(caught));
    } finally {
      if (mountedRef.current) setLibraryBusy(false);
    }
  };

  const clearCache = async () => {
    setError(null);
    try {
      const cleared = await window.refCanvas.media.clearMatchCache();
      if (mountedRef.current) {
        setResult(null);
        setExportedPath(null);
        setApplied(false);
        setNotice(translate("preview.matchCacheCleared").replace("{count}", String(cleared.removed)));
      }
    } catch (caught) {
      if (mountedRef.current) setError(describeError(caught));
    }
  };

  const saveSettings = async (patch: { outputDirectory?: string; useDefault?: boolean; resolveOutputCompensation?: boolean }) => {
    try {
      const next = await window.refCanvas.media.updateMatchSettings(patch);
      if (!mountedRef.current) return;
      setOutputDirectory(next.outputDirectory);
      setCompensation(next.resolveOutputCompensation);
      setNotice(translate("preview.matchSettingsSaved"));
    } catch (caught) {
      if (mountedRef.current) setError(describeError(caught));
    }
  };

  const applyLut = async () => {
    if (!exportedPath) return;
    const next = await window.refCanvas.system.setPreferences({
      previewSettings: { activeLut: exportedPath },
    });
    // 预览面板监听这个事件重建大图；不广播的话设置生效了但画面还是旧的。
    window.dispatchEvent(
      new CustomEvent("refcanvas:preview-settings", { detail: next.previewSettings }),
    );
    setApplied(true);
  };

  const updateControl = <Key extends keyof ReferenceMatchControls>(
    key: Key,
    value: ReferenceMatchControls[Key],
  ) => {
    setControls((current) => ({ ...current, [key]: value }));
  };

  // 分屏对比：按下即捕获指针，拖出面板也不丢；双击回到 50%。
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragToPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = compareRef.current?.getBoundingClientRect();
    if (!box || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const position = ((event.clientX - box.left) / box.width) * 100;
    setDivider(Math.max(0, Math.min(100, position)));
  };

  const ratio = useMemo(() => {
    if (!result || !result.height) return undefined;
    return `${result.width} / ${result.height}`;
  }, [result]);

  // 对比框必须与画面同比例：留黑边时，分界线会落在黑边上，把原图整块
  // 盖掉，看起来就像“对比不显示”。宽度上限按高度上限反算。
  const compareStyle = useMemo(() => {
    if (!ratio || !result) return undefined;
    const aspect = result.width / result.height;
    return {
      aspectRatio: ratio,
      maxWidth: `calc(var(--match-compare-cap, min(58vh, 560px)) * ${aspect})`,
    };
  }, [ratio, result]);

  const ready = referencePath !== null;

  return (
    <div className={`reference-match-studio${dragOver ? " is-drag-over" : ""}`} {...dragProps}>
      <div className="match-source-row">
        <span className="match-source-label">{translate("preview.matchSource")}</span>
        <span className="match-source-name">{fileNameOf(sourcePath)}</span>
        {onChangeSource && (
          <button type="button" className="match-reference-change" onClick={onChangeSource}>
            {translate("preview.matchChangeSource")}
          </button>
        )}
      </div>

      <div className="match-reference-row">
        <button
          type="button"
          className={`match-reference-slot${dragOver ? " is-drag-over" : ""}`}
          onClick={() => void pickReference()}
        >
          {analysis ? (
            <img className="match-reference-thumb" src={analysis.url} alt="" />
          ) : (
            <span className="match-reference-empty"><ImageOff size={14} /></span>
          )}
          <span className="match-reference-name">
            {referencePath ? fileNameOf(referencePath) : translate("preview.matchPickReference")}
          </span>
        </button>
        {referencePath && (
          <button type="button" className="match-reference-change" onClick={() => void pickReference()}>
            {translate("preview.matchChangeReference")}
          </button>
        )}
        <label className="match-size">
          <span>{translate("preview.matchWorkspace")}</span>
          <SelectMenu
            value={workspace}
            options={WORKSPACE_OPTIONS.map((option) => ({
              value: option.value,
              label: translate(option.labelKey),
            }))}
            onValueChange={(value) => setWorkspace(value)}
            ariaLabel={translate("preview.matchWorkspace")}
            className="match-size-menu match-workspace-menu"
          />
        </label>
        {workspace === "slog3" && (
          <>
            <label className="match-size">
              <span>{translate("preview.matchGamut")}</span>
              <SelectMenu
                value={slog3Gamut}
                options={[
                  { value: "sgamut3-cine", label: translate("preview.matchGamutCine") },
                  { value: "sgamut3", label: translate("preview.matchGamutFull") },
                ]}
                onValueChange={(value) => setSlog3Gamut(value)}
                ariaLabel={translate("preview.matchGamut")}
                className="match-size-menu"
              />
            </label>
            <label className="match-size">
              <span>{translate("preview.matchRange")}</span>
              <SelectMenu
                value={slog3Range}
                options={[
                  { value: "full", label: translate("preview.matchRangeFull") },
                  { value: "video", label: translate("preview.matchRangeVideo") },
                ]}
                onValueChange={(value) => setSlog3Range(value)}
                ariaLabel={translate("preview.matchRange")}
                className="match-size-menu"
              />
            </label>
          </>
        )}
      </div>

      <div className="match-body">
        <div className="match-visual">
          <div
            ref={compareRef}
            className={`match-compare${busy ? " is-busy" : ""}${ready ? "" : " is-empty"}${dragOver ? " is-drag-over" : ""}`}
            style={compareStyle}
            onDoubleClick={() => setDivider(50)}
          >
            {!ready ? (
              // 空状态本身就是投放区：面板一打开就能看出这里是干什么的，
              // 而不是一块等着变成内容的空白。
              <button type="button" className="match-dropzone" onClick={() => void pickReference()}>
                <ImagePlus size={20} aria-hidden="true" />
                <strong>{translate("preview.matchPickReference")}</strong>
                <span>{translate("preview.matchHint")}</span>
              </button>
            ) : result ? (
              <>
                <img className="match-layer match-layer-original" src={result.originalUrl} alt="" draggable={false} />
                <div className="match-layer-clip" style={{ clipPath: `inset(0 0 0 ${divider}%)` }}>
                  <img className="match-layer" src={result.previewUrl} alt="" draggable={false} />
                </div>
                <span className="match-caption match-caption-left">{translate("preview.matchOriginal")}</span>
                <span className="match-caption match-caption-right">{translate("preview.matchResult")}</span>
                <div
                  className="match-divider"
                  style={{ left: `${divider}%` }}
                  role="slider"
                  tabIndex={0}
                  aria-label={translate("preview.matchDivider")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(divider)}
                  onPointerDown={startDrag}
                  onPointerMove={dragToPointer}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") setDivider((value) => Math.max(0, value - 2));
                    if (event.key === "ArrowRight") setDivider((value) => Math.min(100, value + 2));
                  }}
                >
                  <span className="match-divider-grip" aria-hidden="true" />
                </div>
              </>
            ) : (
              <div className="match-compare-placeholder">
                {busy && <LoaderCircle className="spin" size={16} />}
                {!busy && (
                  <span>
                    {workspaceBlocked
                      ? workspace === "slog3"
                        ? translate("preview.matchSlog3NeedsDpx")
                        : translate("preview.matchDpxNeedsWorkspace")
                      : translate("preview.matchWaiting")}
                  </span>
                )}
              </div>
            )}
            {busy && result && (
              <span className="match-busy-indicator" aria-hidden="true"><LoaderCircle className="spin" size={13} /></span>
            )}
          </div>

          {error && <p className="match-error" role="alert">{error}</p>}
          {notice && !error && <p className="match-notice">{notice}</p>}

          <ReferenceScopes
            data={analysis?.scopes ?? null}
            labels={{
              histogram: translate("preview.matchHistogram"),
              vectorscope: translate("preview.matchVectorscope"),
              note: translate("preview.matchScopeNote"),
            }}
          />
        </div>

        <div className="match-side">
          <div className={`match-analysis${ready ? "" : " is-idle"}`}>
            <div className="match-palette" aria-label={translate("preview.matchPalette")}>
              {analysis
                ? analysis.palette.map((swatch) => (
                    <span
                      key={`${swatch.hex}-${swatch.coverage}`}
                      className="match-swatch"
                      style={{ background: swatch.hex, flexGrow: Math.max(0.08, swatch.coverage) }}
                      title={`${swatch.hex} · ${percent(swatch.coverage)}`}
                    />
                  ))
                : Array.from({ length: 6 }, (_, index) => (
                    <span key={index} className="match-swatch match-swatch-empty" style={{ flexGrow: 1 }} />
                  ))}
            </div>
            <div className="match-stats">
              <span className="match-stat">
                <small>{translate("preview.matchContrast")}</small>
                <strong>{analysis ? percent(analysis.brightness.contrastSpan) : "—"}</strong>
              </span>
              <span className="match-stat">
                <small>{translate("preview.matchMedian")}</small>
                <strong>{analysis ? percent(analysis.brightness.median) : "—"}</strong>
              </span>
              <span className="match-stat">
                <small>{translate("preview.matchSaturation")}</small>
                <strong>{analysis ? percent(analysis.saturation.mean) : "—"}</strong>
              </span>
              <span className="match-stat">
                <small>{translate("preview.matchHue")}</small>
                <strong>
                  {analysis
                    ? `${translate(HUE_KEYS[analysis.hue.family])}${
                        analysis.hue.meanDegrees === null ? "" : ` · ${Math.round(analysis.hue.meanDegrees)}°`
                      }`
                    : "—"}
                </strong>
              </span>
            </div>
            {analysing && <span className="match-analysis-busy"><LoaderCircle className="spin" size={12} /></span>}
          </div>

          <div className={`match-controls${ready ? "" : " is-idle"}`}>
            <label className="match-slider">
              <span>{translate("preview.matchStrength")}<strong>{controls.matchStrength}</strong></span>
              <input
                type="range"
                min={0}
                max={100}
                value={controls.matchStrength}
                disabled={!ready}
                onChange={(event) => updateControl("matchStrength", Number(event.target.value))}
              />
            </label>
            <div className="match-zone-row">
              {(
                [
                  ["shadows", "preview.matchShadows"],
                  ["midtones", "preview.matchMidtones"],
                  ["highlights", "preview.matchHighlights"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="match-slider match-slider-compact">
                  <span>{translate(label)}<strong>{controls[key]}</strong></span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={controls[key]}
                    disabled={!ready}
                    onChange={(event) => updateControl(key, Number(event.target.value))}
                  />
                </label>
              ))}
            </div>
            <div className="match-toggles">
              {(
                [
                  ["protectSkin", "preview.matchProtectSkin"],
                  ["protectSaturation", "preview.matchProtectSaturation"],
                  ["protectContrast", "preview.matchProtectContrast"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`match-toggle${controls[key] ? " is-on" : ""}`}
                  aria-pressed={controls[key]}
                  disabled={!ready}
                  onClick={() => updateControl(key, !controls[key])}
                >
                  {translate(label)}
                </button>
              ))}
            </div>

            <div className="match-actions">
              <label className="match-size">
                <span>{translate("preview.matchSize")}</span>
                <SelectMenu
                  value={dimension}
                  options={[
                    { value: 33, label: "33" },
                    { value: 65, label: "65" },
                  ]}
                  onValueChange={(value) => setDimension(value === 65 ? 65 : 33)}
                  ariaLabel={translate("preview.matchSize")}
                  className="match-size-menu"
                  disabled={!ready}
                />
              </label>
              <button
                type="button"
                className="match-export"
                disabled={!result || exporting}
                onClick={() => void exportLut()}
              >
                {exporting ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
                {translate("preview.matchExport")}
              </button>
              <button
                type="button"
                className="match-secondary"
                disabled={!result || exportingPng}
                onClick={() => void exportPng()}
              >
                {exportingPng ? <LoaderCircle className="spin" size={13} /> : null}
                {translate("preview.matchExportPng")}
              </button>
              <button
                type="button"
                className="match-secondary"
                disabled={!result || libraryBusy}
                onClick={() => void importToLibrary()}
              >
                {libraryBusy ? <LoaderCircle className="spin" size={13} /> : <Upload size={13} />}
                {translate("preview.matchImportLibrary")}
              </button>
              <button
                type="button"
                className="match-reset"
                aria-label={translate("preview.matchReset")}
                disabled={!ready}
                onClick={() => setControls(DEFAULT_CONTROLS)}
              >
                <Sparkles size={14} />
              </button>
              <button
                type="button"
                className={`match-reset${settingsOpen ? " is-on" : ""}`}
                aria-label={translate("preview.matchSettings")}
                aria-pressed={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <Settings2 size={14} />
              </button>
            </div>

            {settingsOpen && (
              <div className="match-settings">
                <p className="match-settings-row">
                  <span>{translate("preview.matchOutputDirectory")}</span>
                  <code>{outputDirectory || "—"}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      const directory = await window.refCanvas.system.pickDirectory({
                        title: translate("preview.matchOutputDirectory"),
                      });
                      if (directory) await saveSettings({ outputDirectory: directory });
                    }}
                  >
                    {translate("preview.matchChooseDirectory")}
                  </button>
                  <button type="button" onClick={() => void saveSettings({ useDefault: true })}>
                    {translate("preview.matchUseDefaultDirectory")}
                  </button>
                </p>
                <p className="match-settings-row">
                  <span>{translate("preview.matchResolveLutDirectory")}</span>
                  <code>{resolveLutDirectory || "—"}</code>
                </p>
                <p className="match-settings-row">
                  <span>{translate("preview.matchCompensation")}</span>
                  <button
                    type="button"
                    className={`match-toggle${compensation ? " is-on" : ""}`}
                    aria-pressed={compensation}
                    onClick={() => void saveSettings({ resolveOutputCompensation: !compensation })}
                  >
                    {compensation ? translate("preview.matchOn") : translate("preview.matchOff")}
                  </button>
                </p>
                <p className="match-settings-row">
                  <button type="button" className="match-danger" onClick={() => void clearCache()}>
                    <Trash2 size={12} /> {translate("preview.matchClearCache")}
                  </button>
                </p>
              </div>
            )}

            {exportedPath && (
              <p className="match-exported">
                {translate("preview.matchExported")}{" "}
                <button type="button" onClick={() => void window.refCanvas.system.revealInFolder(exportedPath)}>
                  {fileNameOf(exportedPath)}
                </button>
                {" · "}
                <button type="button" className="match-apply" onClick={() => void applyLut()} disabled={applied}>
                  {translate("preview.matchApply")}
                </button>
              </p>
            )}
            {applied && <p className="match-applied">{translate("preview.matchApplied")}</p>}
            {result && (
              <p className="match-result-meta">
                <FolderOpen size={12} aria-hidden="true" />
                {`${result.workspace} · ${dimension}³`}
                {result.workspace === "slog3" ? ` · ${result.baseline}` : ""}
                {result.workspace === "dwg"
                  ? ` · ${translate("preview.matchCompensation")} ${result.resolveOutputCompensation ? translate("preview.matchOn") : translate("preview.matchOff")}`
                  : ""}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

