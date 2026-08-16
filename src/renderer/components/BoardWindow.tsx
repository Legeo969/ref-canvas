import { ImageDown, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AssetRecord,
  BoardDocumentV3,
  BoardSummary,
} from "../../shared/contracts";
import { useDialog } from "./DialogProvider";
import { BoardCanvas } from "./BoardCanvas";
import { translate } from "../app/i18n";

interface BoardWindowProps {
  boardId: string;
}

/**
 * 独立白板窗口（URL `?board=<id>&mode=window` 时由 App 短路渲染）：
 * 只加载目标白板与被引用素材，BoardCanvas 零 props 改动复用。
 * 白板切换 = 在新窗口打开目标白板后关闭当前窗口（保持“一板一窗”）。
 */
export function BoardWindow({ boardId }: BoardWindowProps) {
  const dialog = useDialog();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [board, setBoard] = useState<BoardSummary | null>(null);
  const [document, setDocument] = useState<BoardDocumentV3 | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [failed, setFailed] = useState(false);

  const loadAssets = useCallback(async (id: string) => {
    // 阶段 6 §11：打开时批量解析引用（main 侧并行 stat + fingerprint
    // 自动重连）；解析结果修正 path 与 linkState。
    const [referenced, resolutions] = await Promise.all([
      window.refCanvas.boards.getAssets(id),
      window.refCanvas.boards.resolveReferences(id),
    ]);
    const byId = new Map(
      resolutions.map((resolution) => [resolution.assetId, resolution]),
    );
    setAssets(
      referenced.map((asset) => {
        const resolution = byId.get(asset.id);
        if (!resolution) return asset;
        return {
          ...asset,
          path: resolution.path ?? asset.path,
          linkState: resolution.state as AssetRecord["linkState"],
        };
      }),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [boardList, loaded] = await Promise.all([
          window.refCanvas.boards.list(),
          window.refCanvas.boards.load(boardId),
        ]);
        if (cancelled || !loaded) {
          if (!cancelled) setFailed(true);
          return;
        }
        setBoards(boardList);
        setBoard(loaded.summary);
        setDocument(loaded.document);
        await window.refCanvas.boards.touch(boardId);
        await loadAssets(boardId);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, loadAssets]);

  const save = async (next: BoardDocumentV3, revision: number) => {
    if (!board) throw new Error("BOARD_NOT_FOUND");
    const summary = await window.refCanvas.boards.save(
      board.id,
      next,
      revision,
    );
    setDocument(next);
    setBoard(summary);
    return summary;
  };

  /** 切换到另一个白板：在新窗口打开目标，关闭当前窗口。 */
  const openBoardElsewhere = async (id: string) => {
    if (!board || id === board.id) return;
    await window.refCanvas.boards.openWindow(id);
    window.close();
  };

  const createBoard = async () => {
    const values = await dialog.requestForm({
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
    });
    if (!values) return;
    const summary = await window.refCanvas.boards.create(String(values.title));
    await window.refCanvas.boards.openWindow(summary.id);
    window.close();
  };

  const renameBoard = async (target: BoardSummary) => {
    const values = await dialog.requestForm({
      title: translate("board.renameBoardTitle"),
      confirmLabel: translate("collections.save"),
      fields: [
        {
          name: "title",
          label: translate("boards.nameLabel"),
          initialValue: target.title,
          required: true,
          maxLength: 120,
        },
      ],
    });
    if (!values) return;
    const summary = await window.refCanvas.boards.rename(
      target.id,
      String(values.title),
    );
    setBoards((current) =>
      current.map((item) => (item.id === summary.id ? summary : item)),
    );
    setBoard((current) => (current?.id === summary.id ? summary : current));
  };

  const deleteBoard = async (target: BoardSummary) => {
    const confirmed = await dialog.requestConfirm({
      title: translate("board.deleteBoardConfirm").replace("{title}", target.title),
      description: translate("board.deleteBoardDescription"),
      confirmLabel: translate("board.delete"),
      danger: true,
    });
    if (!confirmed) return;
    await window.refCanvas.boards.delete(target.id);
    const remaining = boards.filter((item) => item.id !== target.id);
    if (remaining[0]) {
      await window.refCanvas.boards.openWindow(remaining[0].id);
    }
    window.close();
  };

  if (failed) {
    return (
      <div className="board-window-mode board-window-error">
        <p>{translate("boards.unavailable")}</p>
        <button
          className="primary-button"
          onClick={() => void window.refCanvas.boards.closeWindow()}
        >
          {translate("board.closeWindow")}
        </button>
      </div>
    );
  }

  if (!board || !document) {
    return <div className="board-window-mode board-window-loading">{translate("board.loading")}</div>;
  }

  return (
    <div className="board-window-mode">
      <header className="board-window-titlebar">
        <span className="board-window-drag" title={board.title}>
          {board.title}
        </span>
        <button
          className="icon-button"
          aria-label={translate("titlebar.exportPng")}
          title={translate("titlebar.exportPng")}
          onClick={() => window.dispatchEvent(new Event("refcanvas:export-png"))}
        >
          <ImageDown size={15} />
        </button>
        <button
          className="icon-button"
          aria-label={translate("board.closeWindow")}
          title={translate("board.closeWindow")}
          onClick={() => void window.refCanvas.boards.closeWindow()}
        >
          <X size={15} />
        </button>
      </header>
      <BoardCanvas
        board={board}
        document={document}
        assets={assets}
        boards={boards}
        onSelectAsset={() => undefined}
        onSave={save}
        onSwitchBoard={(id) => openBoardElsewhere(id)}
        onCreateBoard={() => createBoard()}
        onRenameBoard={(target) => renameBoard(target)}
        onDeleteBoard={(target) => deleteBoard(target)}
        onLibraryChanged={() => loadAssets(board.id)}
        onReferencesChanged={() => loadAssets(board.id)}
      />
    </div>
  );
}
