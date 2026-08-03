import {
  ArchiveRestore,
  Clipboard,
  DatabaseBackup,
  FileWarning,
  FolderOpen,
  FolderSync,
  FolderX,
  Gauge,
  Info,
  MonitorCog,
  PanelLeftClose,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AppInfo,
  AppPreferences,
  AppPreferencesPatch,
  BackupRecord,
  LibraryPreferences,
  MediaMetadataSnapshot,
  WatchRoot,
} from "../../shared/contracts";
import { PANEL_DEFAULTS } from "../app/panel-layout";
import { useAppStore } from "../app/store";
import { useDialog } from "./DialogProvider";

interface SettingsPanelProps {
  onClose(): void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type SettingsTab = "general" | "library" | "board" | "maintenance" | "about";

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Info }> = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "library", label: "资料库", icon: FolderOpen },
  { id: "board", label: "白板", icon: MonitorCog },
  { id: "maintenance", label: "数据维护", icon: Gauge },
  { id: "about", label: "关于", icon: Info },
];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const store = useAppStore();
  const dialog = useDialog();
  const reloadAssets = useAppStore((state) => state.reloadAssets);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(
    null,
  );
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [watchRoots, setWatchRoots] = useState<WatchRoot[]>([]);
  const [migrationResult, setMigrationResult] = useState("");
  const [mediaMetadata, setMediaMetadata] = useState<MediaMetadataSnapshot>({
    state: "idle",
    total: 0,
    processed: 0,
    updated: 0,
    failed: 0,
  });

  const libraryPreferences = store.preferences;

  const reload = async () => {
    const [nextBackups, nextWatchRoots] = await Promise.all([
      window.refCanvas.backups.list(),
      window.refCanvas.library.listWatchRoots(),
    ]);
    setBackups(nextBackups);
    setWatchRoots(nextWatchRoots);
  };

  useEffect(() => {
    void window.refCanvas.system.getPreferences().then(setAppPreferences);
    void window.refCanvas.system.getAppInfo().then(setAppInfo);
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
    window.dispatchEvent(
      new CustomEvent("refcanvas:board-settings", {
        detail: next.boardSettings,
      }),
    );
  };

  const setLibraryPreference = async (patch: Partial<LibraryPreferences>) => {
    await store.setPreferences(patch);
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
        ? `资料库：${appInfo.libraryPath}`
        : "资料库：未打开",
      `数据目录：${appInfo.userDataPath}`,
    ];
    return lines.join("\n");
  }, [appInfo]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal-panel settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <Settings2 size={18} />
            <div>
              <h2>设置</h2>
              <p>通用、资料库与白板偏好保存在当前资料库或应用级设置中。</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-tabs" aria-label="设置分组">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={tab === item.id ? "active" : ""}
                  key={item.id}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="settings-content">
            {tab === "general" && (
              <div className="settings-group">
                <h3>通用</h3>
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
                    启用全局快捷键
                    <small>Ctrl+Shift+C 捕获剪贴板，Ctrl+Shift+R 区域截图</small>
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
                    后台驻留
                    <small>
                      关闭窗口后保留主进程与目录监控，从托盘重新打开
                    </small>
                  </span>
                </label>
                <h3>界面布局</h3>
                <button
                  className="secondary-button"
                  onClick={() =>
                    void setLibraryPreference({
                      panelLayout: PANEL_DEFAULTS,
                    })
                  }
                >
                  <PanelLeftClose size={15} />
                  恢复默认布局
                </button>
              </div>
            )}

            {tab === "library" && (
              <div className="settings-group">
                <h3>资料库</h3>
                <label className="settings-row">
                  <span>
                    新素材默认入库方式
                    <small>
                      linked 保留文件原位；managed 复制进资料库（复制到资料库）
                    </small>
                  </span>
                  <select
                    value={libraryPreferences.defaultStorageMode}
                    onChange={(event) =>
                      void setLibraryPreference({
                        defaultStorageMode: event.target.value as
                          | "linked"
                          | "managed",
                      })
                    }
                  >
                    <option value="linked">linked（保留原位）</option>
                    <option value="managed">复制到资料库</option>
                  </select>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={libraryPreferences.includeSubfolderAssets}
                    onChange={(event) =>
                      void setLibraryPreference({
                        includeSubfolderAssets: event.target.checked,
                      })
                    }
                  />
                  <span>
                    文件夹查询默认包含子文件夹
                    <small>可在素材区顶部临时切换</small>
                  </span>
                </label>
                <h3>监控素材文件夹</h3>
                <div className="watch-root-list">
                  {watchRoots.length === 0 && (
                    <p className="watch-root-empty">
                      当前没有持续监控的素材文件夹。
                    </p>
                  )}
                  {watchRoots.map((root) => (
                    <div className="watch-root-row" key={root.id}>
                      <div>
                        <strong title={root.path}>{root.path}</strong>
                        <span>
                          添加于 {new Date(root.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="watch-root-actions">
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void window.refCanvas.system.revealInFolder(
                              root.path,
                            )
                          }
                        >
                          <FolderOpen size={14} />
                          定位
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            void dialog
                              .requestConfirm({
                                title: `停止监控“${root.path}”？`,
                                description:
                                  "已导入素材和文件夹会保留，源文件不会被修改。",
                                confirmLabel: "停止监控",
                              })
                              .then((confirmed) => {
                                if (confirmed) {
                                  void window.refCanvas.library
                                    .removeWatchRoot(root.id)
                                    .then(() => reload());
                                }
                              });
                          }}
                        >
                          <FolderX size={14} />
                          停止监控
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "board" && (
              <div className="settings-group">
                <h3>白板</h3>
                <label className="settings-row">
                  <span>
                    控制方式
                    <small>
                      PureRef 预设：Alt/中键平移、Ctrl 旋转、C 裁切等
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
                    <option value="pureref">PureRef 2.1 直接操作</option>
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

            {tab === "maintenance" && (
              <div className="settings-group">
                <h3>数据维护</h3>
                <div className="maintenance-actions">
                  <button
                    className="secondary-button"
                    onClick={async () => {
                      await window.refCanvas.backups.create();
                      await reload();
                    }}
                  >
                    <DatabaseBackup size={16} />
                    立即备份
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void window.refCanvas.system.rebuildThumbnailCache()
                    }
                  >
                    <ArchiveRestore size={16} />
                    重建缩略图缓存
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void window.refCanvas.system.exportDiagnostics()
                    }
                  >
                    <FileWarning size={16} />
                    导出诊断
                  </button>
                  <button
                    className="secondary-button"
                    disabled={mediaMetadata.state === "running"}
                    onClick={() =>
                      void window.refCanvas.library.startMediaMetadataRebuild()
                    }
                  >
                    <ScanLine size={16} />
                    {mediaMetadata.state === "running"
                      ? "正在解析媒体"
                      : "重建媒体元数据"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void dialog.requestForm({
                        title: "迁移素材路径",
                        description:
                          "将原根目录下的素材路径映射到新目录，不移动源文件。",
                        confirmLabel: "开始迁移",
                        fields: [
                          {
                            name: "fromRoot",
                            label: "原素材根目录",
                            type: "directory",
                            required: true,
                            maxLength: 32_768,
                          },
                          {
                            name: "toRoot",
                            label: "新素材根目录",
                            type: "directory",
                            required: true,
                            maxLength: 32_768,
                          },
                        ],
                        onSubmit: async ({ fromRoot, toRoot }) => {
                          const report =
                            await window.refCanvas.library.migratePaths(
                              fromRoot,
                              toRoot,
                            );
                          setMigrationResult(
                            `路径迁移完成：已迁移 ${report.updated}，断链 ${report.missing}，冲突 ${report.conflicts}，跳过 ${report.skipped}。`,
                          );
                        },
                      })
                    }
                  >
                    <FolderSync size={16} />
                    迁移素材路径
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
                {migrationResult && (
                  <p className="maintenance-result">{migrationResult}</p>
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
                <h3>关于</h3>
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
                    <dt>当前资料库</dt>
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
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
