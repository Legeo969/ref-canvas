/**
 * 浏览标签栏（FND-002 §5.2）。
 *
 * 目录/集合标签支持新建、切换、关闭与拖拽重排；最后一个标签关闭后
 * 自动创建空目录标签（不显示无导航出口的空壳）。
 */
import { Layers, Plus, X } from "lucide-react";
import type { DragEvent } from "react";
import { translate } from "../app/i18n";
import { useAppStore } from "../app/store";

function TabTitle({ tab }: { tab: ReturnType<typeof useAppStore.getState>["browserTabs"][number] }) {
  if (tab.kind === "collection") {
    return (
      <span className="browser-tab-collection" title={tab.targetId}>
        <Layers size={11} />
        {tab.title}
      </span>
    );
  }
  if (tab.targetId === "browser://empty") return <span>{translate("browser.empty")}</span>;
  return <span title={tab.targetId}>{tab.title}</span>;
}

export function BrowserTabBar() {
  const store = useAppStore();
  const tabs = store.browserTabs;
  const activeId = store.activeTabId;

  if (tabs.length === 0) return null;

  const openNewTab = async () => {
    const directory = await window.refCanvas.system.pickDirectory({
      title: translate("directory.newTab"),
    });
    if (directory) await store.createBrowserTabForPath(directory);
  };

  const onDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("application/x-refcanvas-tab-id");
    if (sourceId && sourceId !== targetId) store.reorderBrowserTab(sourceId, targetId);
  };

  return (
    <div className="browser-tabbar" role="tablist" aria-label={translate("browser.tabList")}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          tabIndex={tab.id === activeId ? 0 : -1}
          className={`browser-tab ${tab.id === activeId ? "active" : ""}`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-refcanvas-tab-id", tab.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => onDrop(event, tab.id)}
          onClick={() => void store.switchBrowserTab(tab.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void store.switchBrowserTab(tab.id);
            }
          }}
          onAuxClick={(event) => {
            if (event.button === 1) void store.closeBrowserTab(tab.id);
          }}
        >
          <TabTitle tab={tab} />
          <button
            className="browser-tab-close"
            aria-label={translate("browser.closeTabNamed").replace("{title}", tab.title)}
            title={translate("browser.tab.close")}
            onClick={(event) => {
              event.stopPropagation();
              void store.closeBrowserTab(tab.id);
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        className="browser-tab-new"
        aria-label={translate("browser.tab.new")}
        title={translate("directory.newTab")}
        onClick={() => void openNewTab()}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
