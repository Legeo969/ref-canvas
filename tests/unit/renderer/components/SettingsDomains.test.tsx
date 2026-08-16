// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { AboutSettings } from "../../../../src/renderer/components/settings/AboutSettings";
import { MaintenanceSettings } from "../../../../src/renderer/components/settings/MaintenanceSettings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

describe("settings domain sections", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  function mount(element: React.ReactNode): HTMLDivElement {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(element));
    return host;
  }

  it("keeps uninstall intent in the parent orchestrator", () => {
    const onRequestUninstall = vi.fn();
    const node = mount(
      <AboutSettings
        appInfo={{
          appVersion: "1.2.3",
          electronVersion: "40",
          nodeVersion: "24",
          databaseSchemaVersion: 17,
          libraryPath: "D:\\library",
          libraryName: "Library",
          installChannel: "signed",
          platform: "win32",
          userDataPath: "D:\\data",
          uninstallAvailable: true,
        }}
        versionInfo="version"
        uninstallError=""
        onRequestUninstall={onRequestUninstall}
      />,
    );
    const button = [...node.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("RefCanvas"),
    );
    act(() => button?.click());
    expect(onRequestUninstall).toHaveBeenCalledOnce();
  });

  it("renders maintenance progress and delegates backup actions", () => {
    const onCreateBackup = vi.fn();
    const onRestoreBackup = vi.fn();
    const backup = {
      filename: "backup.db",
      path: "D:\\backup.db",
      size: 1024,
      createdAt: "2026-08-12T00:00:00.000Z",
      automatic: false,
    };
    const node = mount(
      <MaintenanceSettings
        backups={[backup]}
        mediaMetadata={{ state: "completed", total: 10, processed: 10, updated: 9, failed: 1 }}
        onCreateBackup={onCreateBackup}
        onRestoreBackup={onRestoreBackup}
      />,
    );
    const buttons = [...node.querySelectorAll("button")];
    act(() => buttons.find((item) => item.textContent?.includes("立即备份"))?.click());
    act(() => buttons.find((item) => item.textContent === "恢复")?.click());
    expect(onCreateBackup).toHaveBeenCalledOnce();
    expect(onRestoreBackup).toHaveBeenCalledWith(backup);
    expect(node.textContent).toContain("10 / 10");
  });
});
