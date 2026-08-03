import { ImageDown, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AssetRecord,
  BoardDocumentV3,
  BoardSummary,
} from "../../shared/contracts";
import { useDialog } from "./DialogProvider";
import { BoardCanvas } from "./BoardCanvas";

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
    const referenced = await window.refCanvas.boards.getAssets(id);
    setAssets(referenced);
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

  const save = async (next: BoardDocumentV3) => {
    if (!board) return;
    const summary = await window.refCanvas.boards.save(board.id, next);
    setDocument(next);
    setBoard(summary);
  };

  /** 切换到另一个白板：在新窗口打开目标，关闭当前窗口。 */
  const openBoardElsewhere = async (id: string) => {
    if (!board || id === board.id) return;
    // 先保存当前文档，避免切换丢失。
    if (document) {
      await window.refCanvas.boards.save(board.id, document);
    }
    await window.refCanvas.boards.openWindow(id);
    window.close();
  };

  const createBoard = async () => {
    const values = await dialog.requestForm({
      title: "新建白板",
      confirmLabel: "创建",
      fields: [
        {
          name: "title",
          label: "白板名称",
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
      title: "重命名白板",
      confirmLabel: "保存",
      fields: [
        {
          name: "title",
          label: "白板名称",
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
      title: `删除白板“${target.title}”？`,
      description: "白板文档与素材数据相互独立，删除不会影响素材。",
      confirmLabel: "删除",
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
        <p>无法打开白板</p>
        <button
          className="primary-button"
          onClick={() => void window.refCanvas.boards.closeWindow()}
        >
          关闭窗口
        </button>
      </div>
    );
  }

  if (!board || !document) {
    return <div className="board-window-mode board-window-loading">正在加载白板…</div>;
  }

  return (
    <div className="board-window-mode">
      <header className="board-window-titlebar">
        <span className="board-window-drag" title={board.title}>
          {board.title}
        </span>
        <button
          className="icon-button"
          aria-label="导出 PNG"
          title="导出 PNG"
          onClick={() => window.dispatchEvent(new Event("refcanvas:export-png"))}
        >
          <ImageDown size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="关闭窗口"
          title="关闭窗口"
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
      />
    </div>
  );
}
