import {
  Check,
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
  PreviewFormatGroupId,
  PreviewSettings,
  MediaMetadataSnapshot,
  RegisteredScript,
} from "../../shared/contracts";
import { PREVIEW_SETTINGS_DEFAULTS } from "../../shared/contracts";
import { APP_LANGUAGES, translate } from "../app/i18n";
import type { MessageKey } from "../app/i18n";
import type { AppLanguage } from "../../shared/contracts";
import { PANEL_DEFAULTS } from "../app/panel-layout";
import { useAppStore } from "../app/store";
import { useDialog } from "./DialogProvider";
import { AiProviderSettings } from "./AiProviderSettings";
import { SelectMenu } from "./SelectMenu";
import { AboutSettings } from "./settings/AboutSettings";
import { MaintenanceSettings } from "./settings/MaintenanceSettings";

export type SettingsTab =
  | "general"
  | "board"
  | "preview"
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
  { id: "preview", labelKey: "settings.options", icon: ScanLine },
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

  const previewSettings =
    appPreferences?.previewSettings ?? PREVIEW_SETTINGS_DEFAULTS;

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
    if (next.previewSettings) {
      window.dispatchEvent(
        new CustomEvent("refcanvas:preview-settings", {
          detail: next.previewSettings,
        }),
      );
    }
  };

  const updateFpsPresets = (
    presets: number[],
    defaultFps = previewSettings.defaultSequenceFps,
  ) => {
    const normalized = Array.from(new Set(presets)).slice(0, 10);
    if (!normalized.length) return;
    void setAppPreference({
      previewSettings: {
        sequenceFpsPresets: normalized,
        defaultSequenceFps: normalized.includes(defaultFps)
          ? defaultFps
          : normalized[0],
      },
    });
  };

  const updateMp4Presets = (mp4Presets: PreviewSettings["mp4Presets"]) => {
    void setAppPreference({ previewSettings: { mp4Presets } });
  };

  const addFormatExtension = (groupId: PreviewFormatGroupId, value: string) => {
    const extension = value.trim().replace(/^\./, "").toLowerCase();
    if (!/^[a-z0-9]{1,16}$/.test(extension)) return;
    const groups = previewSettings.formatGroups.map((group) =>
      group.id === groupId
        ? { ...group, extensions: [...new Set([...group.extensions, extension])] }
        : group,
    );
    void setAppPreference({ previewSettings: { formatGroups: groups } });
  };

  const removeFormatExtension = (groupId: PreviewFormatGroupId, extension: string) => {
    const groups = previewSettings.formatGroups.map((group) =>
      group.id === groupId
        ? { ...group, extensions: group.extensions.filter((item) => item !== extension) }
        : group,
    );
    void setAppPreference({ previewSettings: { formatGroups: groups } });
  };

  const addWhitelistExtension = (value: string) => {
    const extension = value.trim().replace(/^\./, "").toLowerCase();
    if (!/^[a-z0-9]{1,16}$/.test(extension)) return;
    void setAppPreference({
      previewSettings: {
        formatWhitelist: [...new Set([...previewSettings.formatWhitelist, extension])],
      },
    });
  };

  const removeWhitelistExtension = (extension: string) => {
    void setAppPreference({
      previewSettings: {
        formatWhitelist: previewSettings.formatWhitelist.filter((item) => item !== extension),
      },
    });
  };

  const versionInfo = useMemo(() => {
    if (!appInfo) return "";
    const lines = [
      `RefCanvas ${appInfo.appVersion}`,
      `${translate("settings.about.installChannel")}：${appInfo.installChannel}`,
      `Electron ${appInfo.electronVersion}`,
      `Node ${appInfo.nodeVersion}`,
      `${translate("settings.about.databaseSchema")} ${appInfo.databaseSchemaVersion}`,
      appInfo.libraryPath
        ? `${translate("settings.about.indexDatabase")}：${appInfo.libraryPath}`
        : `${translate("settings.about.indexDatabase")}：${translate("settings.about.libraryNotOpen")}`,
      `${translate("settings.about.dataDirectory")}：${appInfo.userDataPath}`,
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
                  <SelectMenu
                    value={appPreferences?.language ?? "en"}
                    ariaLabel={translate("settings.language")}
                    options={APP_LANGUAGES.map((language) => ({
                      value: language.code,
                      label: language.label,
                    }))}
                    onValueChange={(value) =>
                      void setAppPreference({
                        language: value as AppLanguage,
                      })
                    }
                  />
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
                    {translate("settings.board.controls")}
                    <small>
                      {translate("settings.board.controlsHint")}
                    </small>
                  </span>
                  <SelectMenu
                    value={
                      appPreferences?.boardSettings.interactionPreset ?? "pureref"
                    }
                    ariaLabel={translate("settings.board.controls")}
                    options={[
                      { value: "pureref", label: translate("settings.board.controlsPureRef") },
                      { value: "standard", label: translate("settings.board.controlsStandard") },
                    ]}
                    onValueChange={(value) =>
                      void setAppPreference({
                        boardSettings: {
                          interactionPreset: value,
                        },
                      })
                    }
                  />
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
                    {translate("settings.board.snap")}
                    <small>{translate("settings.board.snapHint")}</small>
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
                    {translate("settings.board.bringToFront")}
                    <small>{translate("settings.board.bringToFrontHint")}</small>
                  </span>
                </label>
                <label className="settings-row">
                  <span>
                    {translate("settings.board.sampling")}
                    <small>{translate("settings.board.samplingHint")}</small>
                  </span>
                  <SelectMenu
                    value={
                      appPreferences?.boardSettings.sampling ?? "bilinear"
                    }
                    ariaLabel={translate("settings.board.sampling")}
                    options={[
                      { value: "bilinear", label: translate("settings.board.samplingBilinear") },
                      { value: "nearest", label: translate("settings.board.samplingNearest") },
                    ]}
                    onValueChange={(value) =>
                      void setAppPreference({
                        boardSettings: {
                          sampling: value,
                        },
                      })
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>
                    {translate("settings.board.undoLimit")}
                    <small>{translate("settings.board.undoLimitHint")}</small>
                  </span>
                  <SelectMenu
                    value={appPreferences?.boardSettings.undoLimit ?? 99}
                    ariaLabel={translate("settings.board.undoLimit")}
                    options={[20, 50, 99, 200].map((value) => ({
                      value,
                      label: translate("settings.board.undoSteps").replace("{value}", String(value)),
                    }))}
                    onValueChange={(value) =>
                      void setAppPreference({
                        boardSettings: { undoLimit: value },
                      })
                    }
                  />
                </label>
              </div>
            )}

            {tab === "preview" && (
              <div className="settings-group">
                <h3>{translate("settings.options")}</h3>
                <label className="settings-row">
                  <span>
                    {translate("settings.preview.showHiddenFiles")}
                    <small>{translate("settings.preview.showHiddenFilesHint")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={appPreferences?.previewSettings.showHiddenFiles ?? false}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: {
                          showHiddenFiles: event.target.checked,
                        },
                      })
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>
                    {translate("settings.preview.folderOpenMode")}
                    <small>{translate("settings.preview.folderOpenModeHint")}</small>
                  </span>
                  <SelectMenu
                    value={appPreferences?.previewSettings.folderClickMode ?? "double"}
                    ariaLabel={translate("settings.preview.folderOpenMode")}
                    options={[
                      { value: "single", label: translate("settings.preview.folderOpenSingle") },
                      { value: "double", label: translate("settings.preview.folderOpenDouble") },
                    ]}
                    onValueChange={(value) =>
                      void setAppPreference({
                        previewSettings: {
                          folderClickMode: value,
                        },
                      })
                    }
                  />
                </label>
                <h3>{translate("settings.preview.formatSupport")}</h3>
                <div className="format-groups-editor">
                  {previewSettings.formatGroups.map((group) => (
                    <section className="format-group-editor" key={group.id}>
                      <header>
                        <strong>{group.label}</strong>
                        <span>{translate("directory.extensionCount").replace("{count}", String(group.extensions.length))}</span>
                      </header>
                      <div className="format-extension-chips">
                        {group.extensions.map((extension) => (
                          <span className="format-extension-chip" key={extension}>
                            .{extension}
                            <button
                              type="button"
                              aria-label={translate("settings.preview.removeExtension").replace("{extension}", extension)}
                              title={translate("settings.preview.remove")}
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
                        placeholder={translate("settings.preview.extensionPlaceholder")}
                        aria-label={translate("settings.preview.addExtensionFor").replace("{group}", group.label)}
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
                      <strong>{translate("settings.preview.otherWhitelist")}</strong>
                      <span>{translate("directory.extensionCount").replace("{count}", String(previewSettings.formatWhitelist.length))}</span>
                    </header>
                    <p>{translate("settings.preview.whitelistHint")}</p>
                    <div className="format-extension-chips">
                      {previewSettings.formatWhitelist.map((extension) => (
                        <span className="format-extension-chip" key={extension}>
                          .{extension}
                          <button
                            type="button"
                            aria-label={translate("settings.preview.removeWhitelistExtension").replace("{extension}", extension)}
                            title={translate("settings.preview.remove")}
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
                      placeholder={translate("settings.preview.extensionPlaceholder")}
                      aria-label={translate("settings.preview.addWhitelistExtension")}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addWhitelistExtension(event.currentTarget.value);
                        event.currentTarget.value = "";
                      }}
                    />
                  </section>
                </div>
                <h3>{translate("settings.preview.advancedPreview")}</h3>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.previewSettings.autoplayVideo ?? true}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: { autoplayVideo: event.target.checked },
                      })
                    }
                  />
                  <span>
                    {translate("settings.preview.autoplayVideo")}
                    <small>{translate("settings.preview.autoplayVideoHint")}</small>
                  </span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.previewSettings.autoplaySequence ?? true}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: { autoplaySequence: event.target.checked },
                      })
                    }
                  />
                  <span>
                    {translate("settings.preview.autoplaySequence")}
                    <small>{translate("settings.preview.autoplaySequenceHint")}</small>
                  </span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.previewSettings.autoplayModel3d ?? false}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: { autoplayModel3d: event.target.checked },
                      })
                    }
                  />
                  <span>
                    {translate("settings.preview.autoplayModel3d")}
                    <small>{translate("settings.preview.autoplayModel3dHint")}</small>
                  </span>
                </label>
                <div className="settings-row fps-preset-select-row">
                  <span>
                    {translate("settings.preview.sequenceFpsPresets")}
                    <small>{translate("settings.preview.sequenceFpsPresetsHint")}</small>
                  </span>
                  <SelectMenu
                    value={previewSettings.defaultSequenceFps}
                    ariaLabel={translate("settings.preview.sequenceFpsPresets")}
                    options={previewSettings.sequenceFpsPresets.map((preset) => ({
                      value: preset,
                      label: `${preset} FPS`,
                    }))}
                    onValueChange={(preset) =>
                      updateFpsPresets(previewSettings.sequenceFpsPresets, preset)
                    }
                  />
                </div>
                <label className="settings-row">
                  <span>
                    {translate("settings.preview.alphaBackground")}
                    <small>{translate("settings.preview.alphaBackgroundHint")}</small>
                  </span>
                  <SelectMenu
                    value={appPreferences?.previewSettings.alphaBackground ?? "checker"}
                    ariaLabel={translate("settings.preview.alphaBackground")}
                    options={[
                      { value: "checker", label: translate("settings.preview.alphaChecker") },
                      { value: "black", label: translate("settings.preview.alphaBlack") },
                      { value: "white", label: translate("settings.preview.alphaWhite") },
                      { value: "custom", label: translate("settings.preview.alphaCustom") },
                    ]}
                    onValueChange={(value) =>
                      void setAppPreference({
                        previewSettings: {
                          alphaBackground: value,
                        },
                      })
                    }
                  />
                </label>
                {(appPreferences?.previewSettings.alphaBackground ?? "checker") ===
                  "custom" && (
                  <label className="settings-row">
                    <span>{translate("settings.preview.customAlphaColor")}</span>
                    <input
                      type="color"
                      value={appPreferences?.previewSettings.alphaCustomColor ?? "#404040"}
                      onChange={(event) =>
                        void setAppPreference({
                          previewSettings: { alphaCustomColor: event.target.value },
                        })
                      }
                    />
                  </label>
                )}
                <label className="settings-row">
                  <span>
                    {translate("settings.preview.uiScale")}
                    <small>{translate("settings.preview.uiScaleHint")}</small>
                  </span>
                  <input
                    type="number"
                    min={0.8}
                    max={1.5}
                    step={0.05}
                    value={appPreferences?.previewSettings.uiScale ?? 1}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: {
                          uiScale: Number(event.target.value) || 1,
                        },
                      })
                    }
                  />
                </label>

                <h3>{translate("settings.preview.performance")}</h3>
                <label className="settings-row">
                  <span>
                    {translate("settings.preview.previewConcurrency")}
                    <small>{translate("settings.preview.previewConcurrencyHint")}</small>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={appPreferences?.previewSettings.previewConcurrency ?? 4}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: {
                          previewConcurrency:
                            Math.max(1, Math.min(16, Number(event.target.value) || 4)),
                        },
                      })
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>
                    {translate("settings.preview.thumbnailWorkerThreads")}
                    <small>{translate("settings.preview.thumbnailWorkerThreadsHint")}</small>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={appPreferences?.previewSettings.thumbnailWorkerThreads ?? 1}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: {
                          thumbnailWorkerThreads:
                            Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                        },
                      })
                    }
                  />
                </label>

                <h3>{translate("settings.preview.outputWorkflow")}</h3>
                <label className="settings-row">
                  <span>
                    {translate("settings.preview.downscaleMode")}
                    <small>{translate("settings.preview.downscaleModeHint")}</small>
                  </span>
                  <SelectMenu
                    value={appPreferences?.previewSettings.downscaleMode ?? "suffix"}
                    ariaLabel={translate("settings.preview.downscaleMode")}
                    options={[
                      { value: "suffix", label: translate("settings.preview.downscaleSuffixMode") },
                      { value: "subdirectory", label: translate("settings.preview.downscaleSubdirMode") },
                      { value: "backup", label: translate("settings.preview.downscaleBackupMode") },
                    ]}
                    onValueChange={(value) =>
                      void setAppPreference({
                        previewSettings: {
                          downscaleMode: value,
                        },
                      })
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>{translate("settings.preview.downscaleSuffix")}</span>
                  <input
                    type="text"
                    maxLength={32}
                    value={appPreferences?.previewSettings.downscaleSuffix ?? "2k"}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: { downscaleSuffix: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>{translate("settings.preview.downscaleSubdirectory")}</span>
                  <input
                    type="text"
                    maxLength={128}
                    value={appPreferences?.previewSettings.downscaleSubdirectory ?? "downscaled"}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: { downscaleSubdirectory: event.target.value },
                      })
                    }
                  />
                </label>

                <div className="settings-editor">
                  <div className="settings-editor-heading">
                    <span>
                      {translate("settings.preview.mp4Presets")}
                      <small>{translate("settings.preview.mp4PresetsHint")}</small>
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={previewSettings.mp4Presets.length >= 3}
                      onClick={() => {
                        const index = previewSettings.mp4Presets.length + 1;
                        updateMp4Presets([
                          ...previewSettings.mp4Presets,
                          {
                            id: `convert-${Date.now()}`,
                            label: translate("settings.preview.mp4PresetDefault").replace("{index}", String(index)),
                            enabled: false,
                            codec: "h264",
                            quality: "high",
                            resolution: "original",
                          },
                        ]);
                      }}
                    >
                      <Plus size={14} />
                      {translate("settings.preview.add")}
                    </button>
                  </div>
                  <div className="mp4-preset-list">
                    {previewSettings.mp4Presets.map((preset, index) => (
                      <div className="mp4-preset-row" key={preset.id}>
                        <input
                          type="checkbox"
                          checked={preset.enabled}
                          aria-label={translate("settings.preview.presetEnabled").replace("{label}", preset.label)}
                          onChange={(event) => {
                            const next = [...previewSettings.mp4Presets];
                            next[index] = { ...preset, enabled: event.target.checked };
                            updateMp4Presets(next);
                          }}
                        />
                        <input
                          type="text"
                          value={preset.label}
                          aria-label={translate("settings.preview.presetName").replace("{label}", preset.label)}
                          onChange={(event) => {
                            const next = [...previewSettings.mp4Presets];
                            next[index] = { ...preset, label: event.target.value || preset.label };
                            updateMp4Presets(next);
                          }}
                        />
                        <SelectMenu
                          value={preset.codec}
                          ariaLabel={translate("settings.preview.presetCodec").replace("{label}", preset.label)}
                          options={[
                            { value: "h264", label: "H.264" },
                            { value: "h265", label: "H.265" },
                          ]}
                          onValueChange={(value) => {
                            const next = [...previewSettings.mp4Presets];
                            next[index] = { ...preset, codec: value };
                            updateMp4Presets(next);
                          }}
                        />
                        <SelectMenu
                          value={preset.quality}
                          ariaLabel={translate("settings.preview.presetQuality").replace("{label}", preset.label)}
                          options={[
                            { value: "medium", label: translate("settings.preview.qualityMedium") },
                            { value: "high", label: translate("settings.preview.qualityHigh") },
                            { value: "best", label: translate("settings.preview.qualityBest") },
                          ]}
                          onValueChange={(value) => {
                            const next = [...previewSettings.mp4Presets];
                            next[index] = { ...preset, quality: value };
                            updateMp4Presets(next);
                          }}
                        />
                        <SelectMenu
                          value={preset.resolution}
                          ariaLabel={translate("settings.preview.presetResolution").replace("{label}", preset.label)}
                          options={[
                            { value: "original", label: translate("settings.preview.resolutionOriginal") },
                            { value: "half", label: translate("settings.preview.resolutionHalf") },
                            { value: "quarter", label: translate("settings.preview.resolutionQuarter") },
                          ]}
                          onValueChange={(value) => {
                            const next = [...previewSettings.mp4Presets];
                            next[index] = { ...preset, resolution: value };
                            updateMp4Presets(next);
                          }}
                        />
                        <button
                          type="button"
                          className={preset.id === previewSettings.defaultMp4PresetId ? "active" : ""}
                          aria-label={translate("settings.preview.setDefaultPreset").replace("{label}", preset.label)}
                          title={translate("settings.preview.setAsDefault")}
                          disabled={!preset.enabled}
                          onClick={() =>
                            void setAppPreference({
                              previewSettings: {
                                defaultMp4PresetId: preset.id,
                              },
                            })
                          }
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={translate("settings.preview.deletePreset").replace("{label}", preset.label)}
                          disabled={previewSettings.mp4Presets.length === 1}
                          onClick={() =>
                            updateMp4Presets(
                              previewSettings.mp4Presets.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <h3>{translate("settings.preview.colorManagement")}</h3>
                <p className="settings-hint">
                  {colorStatus?.detectedOcio
                    ? translate("settings.preview.ocioDetected").replace("{path}", colorStatus.detectedOcio)
                    : translate("settings.preview.ocioNotDetected")}
                  {colorStatus?.activeLut && !colorStatus.activeLutExists
                    ? translate("settings.preview.lutMissing")
                    : ""}
                  {translate("settings.preview.lutCacheInvalidate")}
                </p>
                <label className="settings-row">
                  <span>
                    {translate("settings.preview.ocioConfigPath")}
                    <small>{translate("settings.preview.ocioConfigPathHint")}</small>
                  </span>
                  <div className="settings-path-control">
                    <input
                      type="text"
                      value={appPreferences?.previewSettings.ocioConfigPath ?? ""}
                      onChange={(event) =>
                        void setAppPreference({
                          previewSettings: {
                            ocioConfigPath: event.target.value || null,
                          },
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={translate("settings.preview.locateOcioConfig")}
                      title={translate("settings.preview.locate")}
                      disabled={!appPreferences?.previewSettings.ocioConfigPath}
                      onClick={() => {
                        const value = appPreferences?.previewSettings.ocioConfigPath;
                        if (value) void window.refCanvas.system.revealInFolder(value);
                      }}
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </label>
                <label className="settings-row">
                  <span>{translate("settings.preview.currentLut")}</span>
                  <div className="settings-path-control">
                    <input
                      type="text"
                      placeholder={translate("settings.preview.lutPlaceholder")}
                      value={appPreferences?.previewSettings.activeLut ?? ""}
                      onChange={(event) =>
                        void setAppPreference({
                          previewSettings: {
                            activeLut: event.target.value || null,
                          },
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={translate("settings.preview.locateLut")}
                      title={translate("settings.preview.locate")}
                      disabled={!appPreferences?.previewSettings.activeLut}
                      onClick={() => {
                        const value = appPreferences?.previewSettings.activeLut;
                        if (value) void window.refCanvas.system.revealInFolder(value);
                      }}
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </label>

                <h3>{translate("settings.preview.scripts")}</h3>
                <p className="settings-hint">
                  {translate("settings.preview.scriptsHint")}
                </p>
                <div className="watch-root-list">
                  {scripts.length === 0 && (
                    <p className="watch-root-empty">
                      {translate("settings.preview.noScripts")}
                    </p>
                  )}
                  {scripts.map((script) => (
                    <div className="watch-root-row" key={script.id}>
                      <div>
                        <strong title={script.path}>{script.name}</strong>
                        <span title={script.hash}>
                          {translate("settings.preview.scriptMeta")
                            .replace("{kind}", script.kind.toUpperCase())
                            .replace("{seconds}", String(Math.round(script.timeoutMs / 1000)))
                            .replace("{hash}", script.hash.slice(0, 12))}
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
                          {translate("settings.preview.locate")}
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
                          {translate("settings.preview.remove")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  className="secondary-button"
                  onClick={async () => {
                    const values = await dialog.requestForm({
                      title: translate("settings.preview.registerScript"),
                      description: translate("settings.preview.registerScriptDescription"),
                      confirmLabel: translate("settings.preview.register"),
                      fields: [
                        {
                          name: "path",
                          label: translate("settings.preview.scriptPathLabel"),
                          required: true,
                          maxLength: 4096,
                        },
                        {
                          name: "timeout",
                          label: translate("settings.preview.scriptTimeoutLabel"),
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
                        error instanceof Error ? error.message : translate("settings.preview.registerFailed"),
                      );
                    }
                  }}
                >
                  <Plus size={14} />
                  {translate("settings.preview.registerScriptEllipsis")}
                </button>

                <h3>{translate("settings.preview.local")}</h3>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={appPreferences?.previewSettings.debugLogging ?? false}
                    onChange={(event) =>
                      void setAppPreference({
                        previewSettings: { debugLogging: event.target.checked },
                      })
                    }
                  />
                  <span>
                    {translate("settings.preview.debugLogging")}
                    <small>{translate("settings.preview.debugLoggingHint")}</small>
                  </span>
                </label>
                <label className="settings-row">
                  <span>
                    {translate("settings.preview.closeBehavior")}
                    <small>{translate("settings.preview.closeBehaviorHint")}</small>
                  </span>
                  <SelectMenu
                    value={appPreferences?.previewSettings.closeBehavior ?? "quit"}
                    ariaLabel={translate("settings.preview.closeBehavior")}
                    options={[
                      { value: "quit", label: translate("settings.preview.closeQuit") },
                      { value: "tray", label: translate("settings.preview.closeTray") },
                    ]}
                    onValueChange={(value) =>
                      void setAppPreference({
                        previewSettings: {
                          closeBehavior: value,
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}

            {tab === "ai" && <AiProviderSettings />}

            {tab === "maintenance" && (
              <MaintenanceSettings
                backups={backups}
                mediaMetadata={mediaMetadata}
                onCreateBackup={() => {
                  void window.refCanvas.backups.create().then(reload);
                }}
                onRestoreBackup={(backup) => {
                  void dialog.requestConfirm({
                    title: translate("settings.restoreBackupTitle"),
                    description: translate("settings.restoreBackupDescription"),
                    confirmLabel: translate("settings.restore"),
                  }).then((confirmed) => {
                    if (confirmed) void window.refCanvas.backups.restore(backup.path);
                  });
                }}
              />
            )}

            {tab === "about" && (
              <AboutSettings
                appInfo={appInfo}
                versionInfo={versionInfo}
                uninstallError={uninstallError}
                onRequestUninstall={() => void requestUninstall()}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
