import {
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  DatabaseBackup,
  FileWarning,
  FolderOpen,
  Gauge,
  Info,
  MonitorCog,
  PanelLeftClose,
  Plus,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AppInfo,
  AppPreferences,
  AppPreferencesPatch,
  BackupRecord,
  ColorStatus,
  FoundFormatGroupId,
  FoundSettings,
  MediaMetadataSnapshot,
  RegisteredScript,
} from "../../shared/contracts";
import { FOUND_SETTINGS_DEFAULTS } from "../../shared/contracts";
import { APP_LANGUAGES, translate } from "../app/i18n";
import type { MessageKey } from "../app/i18n";
import type { AppLanguage } from "../../shared/contracts";
import { PANEL_DEFAULTS } from "../app/panel-layout";
import { useAppStore } from "../app/store";
import { useDialog } from "./DialogProvider";
import { AiProviderSettings } from "./AiProviderSettings";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type SettingsTab =
  | "general"
  | "board"
  | "found"
  | "ai"
  | "maintenance"
  | "about";

interface SettingsPanelProps {
  onClose(): void;
  initialTab?: SettingsTab;
}

const TABS: Array<{ id: SettingsTab; labelKey: MessageKey; icon: typeof Info }> = [
  { id: "general", labelKey: "settings.general", icon: SlidersHorizontal },
  { id: "board", labelKey: "settings.board", icon: MonitorCog },
  { id: "found", labelKey: "settings.options", icon: ScanLine },
  { id: "ai", labelKey: "settings.ai", icon: Sparkles },
  { id: "maintenance", labelKey: "settings.maintenance", icon: Gauge },
  { id: "about", labelKey: "settings.about", icon: Info },
];

export function SettingsPanel({
  onClose,
  initialTab = "general",
}: SettingsPanelProps) {
  const store = useAppStore();
  const dialog = useDialog();
  const reloadAssets = useAppStore((state) => state.reloadAssets);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(
    null,
  );
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [uninstallError, setUninstallError] = useState("");
  const [colorStatus, setColorStatus] = useState<ColorStatus | null>(null);
  const [scripts, setScripts] = useState<RegisteredScript[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [mediaMetadata, setMediaMetadata] = useState<MediaMetadataSnapshot>({
    state: "idle",
    total: 0,
    processed: 0,
    updated: 0,
    failed: 0,
  });

  const foundSettings =
    appPreferences?.foundSettings ?? FOUND_SETTINGS_DEFAULTS;

  const reload = async () => {
    const nextBackups = await window.refCanvas.backups.list();
    setBackups(nextBackups);
  };

  useEffect(() => {
    void window.refCanvas.system.getPreferences().then(setAppPreferences);
    void window.refCanvas.system.getAppInfo().then(setAppInfo);
    void window.refCanvas.color.getStatus().then(setColorStatus);
    void window.refCanvas.scripts.list().then(setScripts);
    void reload();
    void window.refCanvas.library
      .getMediaMetadataRebuild()
      .then(setMediaMetadata);
    return window.refCanvas.library.onMediaMetadataProgress((snapshot) => {
      setMediaMetadata(snapshot);
      if (snapshot.state === "completed") void reloadAssets();
    });
  }, [reloadAssets]);

  const setAppPreference = async (
    patch: AppPreferencesPatch,
  ) => {
    const next = await window.refCanvas.system.setPreferences(patch);
    setAppPreferences(next);
    if (next.language) {
      window.dispatchEvent(
        new CustomEvent("refcanvas:language-changed", {
          detail: next.language,
        }),
      );
    }
    window.dispatchEvent(
      new CustomEvent("refcanvas:board-settings", {
        detail: next.boardSettings,
      }),
    );
    if (next.foundSettings) {
      window.dispatchEvent(
        new CustomEvent("refcanvas:found-settings", {
          detail: next.foundSettings,
        }),
      );
    }
  };

  const updateFpsPresets = (
    presets: number[],
    defaultFps = foundSettings.defaultSequenceFps,
  ) => {
    const normalized = Array.from(new Set(presets)).slice(0, 10);
    if (!normalized.length) return;
    void setAppPreference({
      foundSettings: {
        sequenceFpsPresets: normalized,
        defaultSequenceFps: normalized.includes(defaultFps)
          ? defaultFps
          : normalized[0],
      },
    });
  };

  const moveFpsPreset = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= foundSettings.sequenceFpsPresets.length) return;
    const next = [...foundSettings.sequenceFpsPresets];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateFpsPresets(next);
  };

  const updateMp4Presets = (mp4Presets: FoundSettings["mp4Presets"]) => {
    void setAppPreference({ foundSettings: { mp4Presets } });
  };

  const addFormatExtension = (groupId: FoundFormatGroupId, value: string) => {
    const extension = value.trim().replace(/^\./, "").toLowerCase();
    if (!/^[a-z0-9]{1,16}$/.test(extension)) return;
    const groups = foundSettings.formatGroups.map((group) =>
      group.id === groupId
        ? { ...group, extensions: [...new Set([...group.extensions, extension])] }
        : group,
    );
    void setAppPreference({ foundSettings: { formatGroups: groups } });
  };

  const removeFormatExtension = (groupId: FoundFormatGroupId, extension: string) => {
    const groups = foundSettings.formatGroups.map((group) =>
      group.id === groupId
        ? { ...group, extensions: group.extensions.filter((item) => item !== extension) }
        : group,
    );
    void setAppPreference({ foundSettings: { formatGroups: groups } });
  };

  const addWhitelistExtension = (value: string) => {
    const extension = value.trim().replace(/^\./, "").toLowerCase();
    if (!/^[a-z0-9]{1,16}$/.test(extension)) return;
    void setAppPreference({
      foundSettings: {
        formatWhitelist: [...new Set([...foundSettings.formatWhitelist, extension])],
      },
    });
  };

  const removeWhitelistExtension = (extension: string) => {
    void setAppPreference({
      foundSettings: {
        formatWhitelist: foundSettings.formatWhitelist.filter((item) => item !== extension),
      },
    });
  };

  const versionInfo = useMemo(() => {
    if (!appInfo) return "";
    const lines = [
      `RefCanvas ${appInfo.appVersion}`,
      `安装渠道：${appInfo.installChannel}`,
      `Electron ${appInfo.electronVersion}`,
      `Node ${appInfo.nodeVersion}`,
      `数据库 schema ${appInfo.databaseSchemaVersion}`,
      appInfo.libraryPath
        ? `索引数据库：${appInfo.libraryPath}`
        : "索引数据库：未打开",
      `数据目录：${appInfo.userDataPath}`,
    ];
    return lines.join("\n");
  }, [appInfo]);

  const requestUninstall = async () => {
    setUninstallError("");
    const confirmed = await dialog.requestConfirm({
      title: translate("settings.uninstallConfirmTitle"),
      description: translate("settings.uninstallConfirmDescription"),
      confirmLabel: translate("settings.uninstallConfirmButton"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await window.refCanvas.system.requestUninstall();
    } catch {
      setUninstallError(translate("settings.uninstallFailed"));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal-panel settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={translate("settings.title")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <Settings2 size={18} />
            <div>
              <h2>{translate("settings.title")}</h2>
              <p>{translate("settings.subtitle")}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={translate("settings.close")}>
            <X size={17} />
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-tabs" aria-label={translate("settings.groups")}>
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={tab === item.id ? "active" : ""}
                  key={item.id}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={15} />
                  {translate(item.labelKey)}
                </button>
              );
            })}
          </nav>
          <div className="settings-content">
            {tab === "general" && (
              <div className="settings-group">
                <h3>{translate("settings.general")}</h3>
                <label className="settings-row">
                  <span>
                    {translate("settings.language")}
                    <small>{translate("settings.languageHint")}</small>
                  </span>
                  <select
                    value={appPreferences?.language ?? "en"}
                    onChange={(event) =>
                      void setAppPreference({
                        language: event.target.value as AppLanguage,
                      })
                    }
                  >
                    {APP_LANGUAGES.map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.globalShortcuts ?? false}
                    onChange={(event) =>
                      void setAppPreference({
                        globalShortcuts: event.target.checked,
                      })
                    }
                  />
                  <span>
                    {translate("settings.globalShortcuts")}
                    <small>{translate("settings.globalShortcutsHint")}</small>
                  </span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.backgroundResidency ?? false}
                    onChange={(event) =>
                      void setAppPreference({
                        backgroundResidency: event.target.checked,
                      })
                    }
                  />
                  <span>
                    {translate("settings.backgroundResidency")}
                    <small>{translate("settings.backgroundResidencyHint")}</small>
                  </span>
                </label>
                <h3>{translate("settings.layout")}</h3>
                <button
                  className="secondary-button"
                  onClick={() =>
                    void store.setPreferences({
                      panelLayout: PANEL_DEFAULTS,
                    })
                  }
                >
                  <PanelLeftClose size={15} />
                  {translate("settings.restoreLayout")}
                </button>
              </div>
            )}

            {tab === "board" && (
              <div className="settings-group">
                <h3>{translate("settings.board")}</h3>
                <label className="settings-row">
                  <span>
                    控制方式
                    <small>
                      PureRef 2.1 默认映射：Alt/中键平移、Z 缩放、Ctrl 旋转、C/V 裁切
                    </small>
                  </span>
                  <select
                    value={
                      appPreferences?.boardSettings.interactionPreset ?? "pureref"
                    }
                    onChange={(event) =>
                      void setAppPreference({
                        boardSettings: {
                          interactionPreset: event.target.value as
                            | "pureref"
                            | "standard",
                        },
                      })
                    }
                  >
                    <option value="pureref">PureRef 2.1 默认控制</option>
                    <option value="standard">标准参考板</option>
                  </select>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.boardSettings.snapEnabled ?? true}
                    onChange={(event) =>
                      void setAppPreference({
                        boardSettings: { snapEnabled: event.target.checked },
                      })
                    }
                  />
                  <span>
                    对象吸附
                    <small>拖动时显示临时参考线与目标边缘高亮</small>
                  </span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={
                      appPreferences?.boardSettings.bringToFrontOnSelect ??
                      false
                    }
                    onChange={(event) =>
                      void setAppPreference({
                        boardSettings: {
                          bringToFrontOnSelect: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>
                    选中图片时置顶
                    <small>点击图片对象自动移到图层最前</small>
                  </span>
                </label>
                <label className="settings-row">
                  <span>
                    图片采样
                    <small>近邻采样适合像素美术</small>
                  </span>
                  <select
                    value={
                      appPreferences?.boardSettings.sampling ?? "bilinear"
                    }
                    onChange={(event) =>
                      void setAppPreference({
                        boardSettings: {
                          sampling: event.target.value as
                            | "nearest"
                            | "bilinear",
                        },
                      })
                    }
                  >
                    <option value="bilinear">双线性</option>
                    <option value="nearest">近邻</option>
                  </select>
                </label>
                <label className="settings-row">
                  <span>
                    撤销历史上限
                    <small>超出后丢弃最早的记录</small>
                  </span>
                  <select
                    value={appPreferences?.boardSettings.undoLimit ?? 99}
                    onChange={(event) =>
                      void setAppPreference({
                        boardSettings: { undoLimit: Number(event.target.value) },
                      })
                    }
                  >
                    <option value={20}>20 步</option>
                    <option value={50}>50 步</option>
                    <option value={99}>99 步</option>
                    <option value={200}>200 步</option>
                  </select>
                </label>
              </div>
            )}

            {tab === "found" && (
              <div className="settings-group">
                <h3>{translate("settings.options")}</h3>
                <label className="settings-row">
                  <span>
                    显示隐藏文件
                    <small>目录视图中显示以 . 开头的文件</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={appPreferences?.foundSettings.showHiddenFiles ?? false}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: {
                          showHiddenFiles: event.target.checked,
                        },
                      })
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>
                    文件夹打开方式
                    <small>单击直接进入，或双击进入</small>
                  </span>
                  <select
                    value={appPreferences?.foundSettings.folderClickMode ?? "double"}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: {
                          folderClickMode: event.target.value as "single" | "double",
                        },
                      })
                    }
                  >
                    <option value="single">单击</option>
                    <option value="double">双击</option>
                  </select>
                </label>
                <h3>格式支持</h3>
                <div className="format-groups-editor">
                  {foundSettings.formatGroups.map((group) => (
                    <section className="format-group-editor" key={group.id}>
                      <header>
                        <strong>{group.label}</strong>
                        <span>{group.extensions.length} 个扩展名</span>
                      </header>
                      <div className="format-extension-chips">
                        {group.extensions.map((extension) => (
                          <span className="format-extension-chip" key={extension}>
                            .{extension}
                            <button
                              type="button"
                              aria-label={`移除 .${extension}`}
                              title="移除"
                              onClick={() => removeFormatExtension(group.id, extension)}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                      <input
                        className="format-extension-input"
                        type="text"
                        placeholder="输入扩展名后按 Enter"
                        aria-label={`为 ${group.label} 添加扩展名`}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          addFormatExtension(group.id, event.currentTarget.value);
                          event.currentTarget.value = "";
                        }}
                      />
                    </section>
                  ))}
                  <section className="format-group-editor format-whitelist-editor">
                    <header>
                      <strong>OTHER 白名单</strong>
                      <span>{foundSettings.formatWhitelist.length} 个扩展名</span>
                    </header>
                    <p>纳入 OTHER 筛选的非视觉文件；全部视图仍保留未知文件。</p>
                    <div className="format-extension-chips">
                      {foundSettings.formatWhitelist.map((extension) => (
                        <span className="format-extension-chip" key={extension}>
                          .{extension}
                          <button
                            type="button"
                            aria-label={`移除白名单 .${extension}`}
                            title="移除"
                            onClick={() => removeWhitelistExtension(extension)}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <input
                      className="format-extension-input"
                      type="text"
                      placeholder="输入扩展名后按 Enter"
                      aria-label="添加 OTHER 白名单扩展名"
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addWhitelistExtension(event.currentTarget.value);
                        event.currentTarget.value = "";
                      }}
                    />
                  </section>
                </div>
                <h3>高级预览</h3>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.foundSettings.autoplayVideo ?? true}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: { autoplayVideo: event.target.checked },
                      })
                    }
                  />
                  <span>
                    视频自动播放
                    <small>打开视频预览时立即播放</small>
                  </span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.foundSettings.autoplaySequence ?? true}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: { autoplaySequence: event.target.checked },
                      })
                    }
                  />
                  <span>
                    图片序列自动播放
                    <small>打开序列预览时立即播放</small>
                  </span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.foundSettings.autoplayModel3d ?? false}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: { autoplayModel3d: event.target.checked },
                      })
                    }
                  />
                  <span>
                    3D 模型自动旋转
                    <small>无交互时缓慢旋转模型</small>
                  </span>
                </label>
                <div className="settings-editor">
                  <div className="settings-editor-heading">
                    <span>
                      图片序列 FPS 预设
                      <small>预览和导出共用，勾选项为打开序列时的默认速度</small>
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={foundSettings.sequenceFpsPresets.length >= 10}
                      onClick={() => {
                        const candidates = [15, 24, 25, 30, 60, 90, 120];
                        const next = candidates.find(
                          (value) => !foundSettings.sequenceFpsPresets.includes(value),
                        ) ?? Math.min(240, Math.max(...foundSettings.sequenceFpsPresets) + 1);
                        updateFpsPresets([...foundSettings.sequenceFpsPresets, next]);
                      }}
                    >
                      <Plus size={14} />
                      添加
                    </button>
                  </div>
                  <div className="fps-preset-list">
                    {foundSettings.sequenceFpsPresets.map((preset, index) => (
                      <div className="fps-preset-row" key={`${preset}-${index}`}>
                        <button
                          type="button"
                          className={preset === foundSettings.defaultSequenceFps ? "active" : ""}
                          aria-label={`设 ${preset} FPS 为默认`}
                          title="设为默认"
                          onClick={() => updateFpsPresets(foundSettings.sequenceFpsPresets, preset)}
                        >
                          <Check size={14} />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={240}
                          defaultValue={preset}
                          aria-label={`FPS 预设 ${index + 1}`}
                          onBlur={(event) => {
                            const value = Math.max(1, Math.min(240, Number(event.target.value) || preset));
                            const next = [...foundSettings.sequenceFpsPresets];
                            next[index] = value;
                            updateFpsPresets(next, preset === foundSettings.defaultSequenceFps ? value : undefined);
                          }}
                        />
                        <span>FPS</span>
                        <button
                          type="button"
                          aria-label="上移 FPS 预设"
                          disabled={index === 0}
                          onClick={() => moveFpsPreset(index, -1)}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label="下移 FPS 预设"
                          disabled={index === foundSettings.sequenceFpsPresets.length - 1}
                          onClick={() => moveFpsPreset(index, 1)}
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label="删除 FPS 预设"
                          disabled={foundSettings.sequenceFpsPresets.length === 1}
                          onClick={() =>
                            updateFpsPresets(
                              foundSettings.sequenceFpsPresets.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <label className="settings-row">
                  <span>
                    Alpha 背景
                    <small>透明图片预览的棋盘格/纯色背景</small>
                  </span>
                  <select
                    value={appPreferences?.foundSettings.alphaBackground ?? "checker"}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: {
                          alphaBackground: event.target.value as FoundSettings["alphaBackground"],
                        },
                      })
                    }
                  >
                    <option value="checker">棋盘格</option>
                    <option value="black">黑色</option>
                    <option value="white">白色</option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
                {(appPreferences?.foundSettings.alphaBackground ?? "checker") ===
                  "custom" && (
                  <label className="settings-row">
                    <span>自定义 Alpha 背景色</span>
                    <input
                      type="color"
                      value={appPreferences?.foundSettings.alphaCustomColor ?? "#404040"}
                      onChange={(event) =>
                        void setAppPreference({
                          foundSettings: { alphaCustomColor: event.target.value },
                        })
                      }
                    />
                  </label>
                )}
                <label className="settings-row">
                  <span>
                    UI 缩放
                    <small>0.8–1.5，界面整体缩放</small>
                  </span>
                  <input
                    type="number"
                    min={0.8}
                    max={1.5}
                    step={0.05}
                    value={appPreferences?.foundSettings.uiScale ?? 1}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: {
                          uiScale: Number(event.target.value) || 1,
                        },
                      })
                    }
                  />
                </label>

                <h3>性能</h3>
                <label className="settings-row">
                  <span>
                    预览队列并发
                    <small>同时生成的缩略图数量（1–16）</small>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={appPreferences?.foundSettings.previewConcurrency ?? 4}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: {
                          previewConcurrency:
                            Math.max(1, Math.min(16, Number(event.target.value) || 4)),
                        },
                      })
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>
                    缩略图 worker 线程
                    <small>libvips 并发线程（1–8）</small>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={appPreferences?.foundSettings.thumbnailWorkerThreads ?? 1}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: {
                          thumbnailWorkerThreads:
                            Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                        },
                      })
                    }
                  />
                </label>

                <h3>输出工作流</h3>
                <label className="settings-row">
                  <span>
                    Downscale 命名模式
                    <small>后缀追加 / 分辨率子目录 / 备份原文件</small>
                  </span>
                  <select
                    value={appPreferences?.foundSettings.downscaleMode ?? "suffix"}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: {
                          downscaleMode: event.target.value as FoundSettings["downscaleMode"],
                        },
                      })
                    }
                  >
                    <option value="suffix">文件名追加分辨率</option>
                    <option value="subdirectory">输出到分辨率子目录</option>
                    <option value="backup">保持原名并备份原文件</option>
                  </select>
                </label>
                <label className="settings-row">
                  <span>分辨率后缀（suffix 模式）</span>
                  <input
                    type="text"
                    maxLength={32}
                    value={appPreferences?.foundSettings.downscaleSuffix ?? "2k"}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: { downscaleSuffix: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>分辨率子目录名（subdirectory 模式）</span>
                  <input
                    type="text"
                    maxLength={128}
                    value={appPreferences?.foundSettings.downscaleSubdirectory ?? "downscaled"}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: { downscaleSubdirectory: event.target.value },
                      })
                    }
                  />
                </label>

                <div className="settings-editor">
                  <div className="settings-editor-heading">
                    <span>
                      MP4 转换预设
                      <small>最多 3 个；导出窗口只显示启用的预设</small>
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={foundSettings.mp4Presets.length >= 3}
                      onClick={() => {
                        const index = foundSettings.mp4Presets.length + 1;
                        updateMp4Presets([
                          ...foundSettings.mp4Presets,
                          {
                            id: `convert-${Date.now()}`,
                            label: `转换 ${index}`,
                            enabled: false,
                            codec: "h264",
                            quality: "high",
                            resolution: "original",
                          },
                        ]);
                      }}
                    >
                      <Plus size={14} />
                      添加
                    </button>
                  </div>
                  <div className="mp4-preset-list">
                    {foundSettings.mp4Presets.map((preset, index) => (
                      <div className="mp4-preset-row" key={preset.id}>
                        <input
                          type="checkbox"
                          checked={preset.enabled}
                          aria-label={`${preset.label} 启用`}
                          onChange={(event) => {
                            const next = [...foundSettings.mp4Presets];
                            next[index] = { ...preset, enabled: event.target.checked };
                            updateMp4Presets(next);
                          }}
                        />
                        <input
                          type="text"
                          value={preset.label}
                          aria-label={`${preset.label} 名称`}
                          onChange={(event) => {
                            const next = [...foundSettings.mp4Presets];
                            next[index] = { ...preset, label: event.target.value || preset.label };
                            updateMp4Presets(next);
                          }}
                        />
                        <select
                          value={preset.codec}
                          aria-label={`${preset.label} 编码器`}
                          onChange={(event) => {
                            const next = [...foundSettings.mp4Presets];
                            next[index] = { ...preset, codec: event.target.value as "h264" | "h265" };
                            updateMp4Presets(next);
                          }}
                        >
                          <option value="h264">H.264</option>
                          <option value="h265">H.265</option>
                        </select>
                        <select
                          value={preset.quality}
                          aria-label={`${preset.label} 质量`}
                          onChange={(event) => {
                            const next = [...foundSettings.mp4Presets];
                            next[index] = { ...preset, quality: event.target.value as "medium" | "high" | "best" };
                            updateMp4Presets(next);
                          }}
                        >
                          <option value="medium">中</option>
                          <option value="high">高</option>
                          <option value="best">最佳</option>
                        </select>
                        <select
                          value={preset.resolution}
                          aria-label={`${preset.label} 分辨率`}
                          onChange={(event) => {
                            const next = [...foundSettings.mp4Presets];
                            next[index] = { ...preset, resolution: event.target.value as "original" | "half" | "quarter" };
                            updateMp4Presets(next);
                          }}
                        >
                          <option value="original">原始</option>
                          <option value="half">1/2</option>
                          <option value="quarter">1/4</option>
                        </select>
                        <button
                          type="button"
                          className={preset.id === foundSettings.defaultMp4PresetId ? "active" : ""}
                          aria-label={`设 ${preset.label} 为默认`}
                          title="设为默认"
                          disabled={!preset.enabled}
                          onClick={() =>
                            void setAppPreference({
                              foundSettings: {
                                defaultMp4PresetId: preset.id,
                              },
                            })
                          }
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除 ${preset.label}`}
                          disabled={foundSettings.mp4Presets.length === 1}
                          onClick={() =>
                            updateMp4Presets(
                              foundSettings.mp4Presets.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <h3>色彩管理</h3>
                <p className="settings-hint">
                  {colorStatus?.detectedOcio
                    ? `自动检测 $OCIO：${colorStatus.detectedOcio}`
                    : "未检测到 $OCIO 环境变量"}
                  {colorStatus?.activeLut && !colorStatus.activeLutExists
                    ? "；当前 LUT 文件不存在"
                    : ""}
                  ；LUT 变化会自动失效缩略图缓存
                </p>
                <label className="settings-row">
                  <span>
                    OCIO config 路径
                    <small>留空自动检测 $OCIO；颜色设置缓存键包含 config</small>
                  </span>
                  <div className="settings-path-control">
                    <input
                      type="text"
                      value={appPreferences?.foundSettings.ocioConfigPath ?? ""}
                      onChange={(event) =>
                        void setAppPreference({
                          foundSettings: {
                            ocioConfigPath: event.target.value || null,
                          },
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="定位 OCIO config"
                      title="定位"
                      disabled={!appPreferences?.foundSettings.ocioConfigPath}
                      onClick={() => {
                        const value = appPreferences?.foundSettings.ocioConfigPath;
                        if (value) void window.refCanvas.system.revealInFolder(value);
                      }}
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </label>
                <label className="settings-row">
                  <span>当前 LUT（.cube/.3dl）</span>
                  <div className="settings-path-control">
                    <input
                      type="text"
                      placeholder="绝对路径，留空关闭"
                      value={appPreferences?.foundSettings.activeLut ?? ""}
                      onChange={(event) =>
                        void setAppPreference({
                          foundSettings: {
                            activeLut: event.target.value || null,
                          },
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="定位当前 LUT"
                      title="定位"
                      disabled={!appPreferences?.foundSettings.activeLut}
                      onClick={() => {
                        const value = appPreferences?.foundSettings.activeLut;
                        if (value) void window.refCanvas.system.revealInFolder(value);
                      }}
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </label>

                <h3>脚本（Python/Shell）</h3>
                <p className="settings-hint">
                  注册时记录 sha256 信任锚点；脚本被修改后需重新注册才能运行。
                </p>
                <div className="watch-root-list">
                  {scripts.length === 0 && (
                    <p className="watch-root-empty">
                      还没有注册脚本。目录右键菜单可运行已注册脚本。
                    </p>
                  )}
                  {scripts.map((script) => (
                    <div className="watch-root-row" key={script.id}>
                      <div>
                        <strong title={script.path}>{script.name}</strong>
                        <span title={script.hash}>
                          {script.kind.toUpperCase()} · 超时{" "}
                          {Math.round(script.timeoutMs / 1000)}s · sha256{" "}
                          {script.hash.slice(0, 12)}…
                        </span>
                      </div>
                      <div className="watch-root-actions">
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void window.refCanvas.system.revealInFolder(
                              script.path,
                            )
                          }
                        >
                          <FolderOpen size={14} />
                          定位
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            void window.refCanvas.scripts
                              .unregister(script.id)
                              .then(() =>
                                window.refCanvas.scripts.list().then(setScripts),
                              );
                          }}
                        >
                          <X size={14} />
                          移除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  className="secondary-button"
                  onClick={async () => {
                    const values = await dialog.requestForm({
                      title: "注册脚本",
                      description: "脚本将在目录右键菜单中运行（带信任校验与超时）。",
                      confirmLabel: "注册",
                      fields: [
                        {
                          name: "path",
                          label: "脚本绝对路径（.py / .ps1）",
                          required: true,
                          maxLength: 4096,
                        },
                        {
                          name: "timeout",
                          label: "超时秒数（默认 60）",
                          required: false,
                          maxLength: 6,
                        },
                      ],
                      onSubmit: () => undefined,
                    });
                    if (!values) return;
                    try {
                      await window.refCanvas.scripts.register({
                        path: values.path,
                        timeoutMs: (Number(values.timeout) || 60) * 1000,
                      });
                      const next = await window.refCanvas.scripts.list();
                      setScripts(next);
                    } catch (error) {
                      window.alert(
                        error instanceof Error ? error.message : "注册失败",
                      );
                    }
                  }}
                >
                  <Plus size={14} />
                  注册脚本…
                </button>

                <h3>本地</h3>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.foundSettings.debugLogging ?? false}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: { debugLogging: event.target.checked },
                      })
                    }
                  />
                  <span>
                    Debug 日志
                    <small>主进程输出详细日志</small>
                  </span>
                </label>
                <label className="settings-row">
                  <span>
                    关闭行为
                    <small>关闭窗口时完全退出或最小化到托盘</small>
                  </span>
                  <select
                    value={appPreferences?.foundSettings.closeBehavior ?? "quit"}
                    onChange={(event) =>
                      void setAppPreference({
                        foundSettings: {
                          closeBehavior: event.target.value as "quit" | "tray",
                        },
                      })
                    }
                  >
                    <option value="quit">完全退出</option>
                    <option value="tray">最小化到托盘</option>
                  </select>
                </label>
              </div>
            )}

            {tab === "ai" && <AiProviderSettings />}

            {tab === "maintenance" && (
              <div className="settings-group">
                <h3>{translate("settings.maintenance")}</h3>
                <div className="maintenance-action-list">
                  <button
                    className="maintenance-action"
                    onClick={async () => {
                      await window.refCanvas.backups.create();
                      await reload();
                    }}
                  >
                    <DatabaseBackup size={17} />
                    <span>
                      <strong>立即备份</strong>
                      <small>保存当前本地索引和偏好，可用于回滚。</small>
                    </span>
                  </button>
                  <button
                    className="maintenance-action"
                    onClick={() =>
                      void window.refCanvas.system.rebuildThumbnailCache()
                    }
                  >
                    <ArchiveRestore size={17} />
                    <span>
                      <strong>重建缩略图缓存</strong>
                      <small>清理并重新生成预览图，不改动磁盘源文件。</small>
                    </span>
                  </button>
                  <button
                    className="maintenance-action"
                    onClick={() =>
                      void window.refCanvas.system.exportDiagnostics()
                    }
                  >
                    <FileWarning size={17} />
                    <span>
                      <strong>导出诊断</strong>
                      <small>收集版本、索引和媒体状态，写入诊断文件。</small>
                    </span>
                  </button>
                  <button
                    className="maintenance-action"
                    disabled={mediaMetadata.state === "running"}
                    onClick={() =>
                      void window.refCanvas.library.startMediaMetadataRebuild()
                    }
                  >
                    <ScanLine size={17} />
                    <span>
                      <strong>
                        {mediaMetadata.state === "running"
                          ? "正在解析媒体"
                          : "重建媒体元数据"}
                      </strong>
                      <small>重新提取视频、音频和图片序列的媒体信息。</small>
                    </span>
                  </button>
                </div>
                {mediaMetadata.state !== "idle" && mediaMetadata.total > 0 && (
                  <div className="maintenance-progress">
                    <div>
                      <span>
                        {mediaMetadata.state === "running"
                          ? "正在离线解析视频与音频"
                          : mediaMetadata.state === "cancelled"
                            ? "媒体元数据重建已取消"
                            : "媒体元数据重建完成"}
                      </span>
                      <strong>
                        {mediaMetadata.processed} / {mediaMetadata.total}
                      </strong>
                    </div>
                    <progress
                      max={Math.max(1, mediaMetadata.total)}
                      value={mediaMetadata.processed}
                    />
                    <small>
                      已更新 {mediaMetadata.updated}，失败 {mediaMetadata.failed}
                    </small>
                    {mediaMetadata.state === "running" && (
                      <button
                        type="button"
                        onClick={() =>
                          void window.refCanvas.library.cancelMediaMetadataRebuild()
                        }
                      >
                        取消
                      </button>
                    )}
                  </div>
                )}
                <h3>本地备份</h3>
                <div className="backup-list">
                  {backups.map((backup) => (
                    <div className="backup-row" key={backup.path}>
                      <div>
                        <strong>
                          {backup.automatic ? "自动备份" : "手动备份"}
                        </strong>
                        <span>
                          {new Date(backup.createdAt).toLocaleString()} ·{" "}
                          {formatBytes(backup.size)}
                        </span>
                      </div>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          void dialog
                            .requestConfirm({
                              title: "恢复备份？",
                              description:
                                "恢复会替换当前数据库并重启 RefCanvas。当前数据库会保留回滚副本。",
                              confirmLabel: "恢复",
                            })
                            .then((confirmed) => {
                              if (confirmed) {
                                void window.refCanvas.backups.restore(
                                  backup.path,
                                );
                              }
                            })
                        }
                      >
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "about" && (
              <div className="settings-group about-group">
                <h3>{translate("settings.about")}</h3>
                <div className="about-mark">
                  <span className="brand-mark">R</span>
                  <div>
                    <strong>RefCanvas</strong>
                    <span>{appInfo?.appVersion ?? "…"}</span>
                  </div>
                </div>
                <dl className="about-list">
                  <div>
                    <dt>安装渠道</dt>
                    <dd>{appInfo?.installChannel ?? "…"}</dd>
                  </div>
                  <div>
                    <dt>Electron</dt>
                    <dd>{appInfo?.electronVersion ?? "…"}</dd>
                  </div>
                  <div>
                    <dt>Node</dt>
                    <dd>{appInfo?.nodeVersion ?? "…"}</dd>
                  </div>
                  <div>
                    <dt>数据库 schema</dt>
                    <dd>{appInfo?.databaseSchemaVersion ?? "…"}</dd>
                  </div>
                  <div>
                    <dt>索引数据库</dt>
                    <dd title={appInfo?.libraryPath ?? undefined}>
                      {appInfo?.libraryPath ?? "未打开"}
                    </dd>
                  </div>
                  <div>
                    <dt>平台</dt>
                    <dd>{appInfo?.platform ?? "…"}</dd>
                  </div>
                </dl>
                <div className="about-actions">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void window.refCanvas.system.writeClipboard(versionInfo)
                    }
                  >
                    <Clipboard size={15} />
                    复制版本信息
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void window.refCanvas.system.openDataFolder()
                    }
                  >
                    <FolderOpen size={15} />
                    打开数据目录
                  </button>
                  <button
                    className="secondary-button danger"
                    disabled={!appInfo?.uninstallAvailable}
                    title={
                      appInfo?.uninstallAvailable
                        ? undefined
                        : translate("settings.uninstallHint")
                    }
                    onClick={() => void requestUninstall()}
                  >
                    <Trash2 size={15} />
                    {translate("settings.uninstall")}
                  </button>
                </div>
                {uninstallError && (
                  <p className="about-uninstall-error" role="alert">
                    {uninstallError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
