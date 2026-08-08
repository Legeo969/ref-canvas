import { PanelsTopLeft, Plus, Trash2 } from "lucide-react";
import { translate } from "../app/i18n";
import { useAppStore } from "../app/store";
import { useDialog } from "./DialogProvider";
import { DirectoryBrowser } from "./DirectoryBrowser";
import { CollectionsPanel } from "./CollectionsPanel";

/** Navigation for the disk browser and Fabric reference boards. */
export function Sidebar() {
  const store = useAppStore();
  const dialog = useDialog();

  return (
    <aside className="sidebar">
      <DirectoryBrowser />
      <CollectionsPanel />
      <div className="sidebar-section sidebar-board-section">
        <div className="section-label row-label">
          <span>{translate("sidebar.boards")}</span>
          <button
            className="mini-icon-button"
            aria-label={translate("boards.new")}
            onClick={() =>
              void dialog.requestForm({
                title: translate("boards.new"),
                confirmLabel: translate("boards.createConfirm"),
                fields: [
                  {
                    name: "title",
                    label: translate("boards.nameLabel"),
                    required: true,
                    maxLength: 120,
                  },
                ],
                onSubmit: ({ title }) => store.createBoard(title),
              })
            }
          >
            <Plus size={14} />
          </button>
        </div>
        {store.boards.map((board) => (
          <button
            className={`nav-row ${
              store.workspaceMode === "board" &&
              store.activeBoard?.id === board.id
                ? "active"
                : ""
            }`}
            key={board.id}
            onClick={() => void store.switchBoard(board.id)}
          >
            <PanelsTopLeft size={16} strokeWidth={1.8} />
            <span>{board.title}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-spacer" />
      <button
        className="sidebar-recycle-button"
        onClick={() => void window.refCanvas.system.openRecycleBin()}
        title={translate("sidebar.openRecycleBin")}
      >
        <Trash2 size={15} />
        {translate("sidebar.recycleBin")}
      </button>
    </aside>
  );
}
