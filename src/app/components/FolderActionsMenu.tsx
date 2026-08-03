import {
  ArrowUpToLine,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Lock,
  LockOpen,
  LocateFixed,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CollectionRecord } from "../../shared/contracts";
import { useAppStore } from "../store";
import { useDialog } from "./DialogProvider";

interface FolderActionsMenuProps {
  collection: CollectionRecord;
}

function descendantIds(
  collections: CollectionRecord[],
  parentId: string,
): Set<string> {
  const result = new Set<string>();
  const pending = [parentId];
  while (pending.length) {
    const current = pending.shift()!;
    for (const collection of collections) {
      if (collection.parentId !== current || result.has(collection.id)) {
        continue;
      }
      result.add(collection.id);
      pending.push(collection.id);
    }
  }
  return result;
}

/**
 * 文件夹行上的单一 "…" 菜单。破坏性命令（删除）放在底部并以红色显示，
 * 并经过二次确认，避免普通单击文件夹时误触发。
 */
export function FolderActionsMenu({
  collection,
}: FolderActionsMenuProps) {
  const store = useAppStore();
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
        setMoveOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const moveTargets = useMemo(() => {
    const excluded = descendantIds(store.collections, collection.id);
    excluded.add(collection.id);
    return store.collections
      .filter((item) => !excluded.has(item.id))
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.title.localeCompare(right.title, "zh-CN"),
      );
  }, [store.collections, collection.id]);

  const revealInExplorer = async () => {
    try {
      const page = await window.refCanvas.library.search({
        collectionId: collection.id,
        pageSize: 1,
      });
      const first = page.items[0];
      if (first) {
        await window.refCanvas.system.revealInFolder(
          first.path.replace(/[\\/][^\\/]+$/, ""),
        );
        return;
      }
    } catch {
      // 查询失败时退回资料库根目录。
    }
    if (store.currentLibrary?.root) {
      await window.refCanvas.system.revealInFolder(store.currentLibrary.root);
    }
  };

  const newSubfolder = () =>
    dialog.requestForm({
      title: "新建子文件夹",
      description: `将在“${collection.title}”下创建子文件夹。`,
      confirmLabel: "创建",
      fields: [
        {
          name: "title",
          label: "文件夹名称",
          required: true,
          maxLength: 120,
        },
      ],
      onSubmit: ({ title }) => store.createCollection(title, collection.id),
    });

  const rename = () =>
    dialog.requestForm({
      title: "重命名文件夹",
      confirmLabel: "保存",
      fields: [
        {
          name: "title",
          label: "文件夹名称",
          initialValue: collection.title,
          required: true,
          maxLength: 120,
        },
      ],
      onSubmit: ({ title }) =>
        store.updateCollection(collection.id, { title }),
    });

  const lock = () =>
    dialog.requestForm({
      title: `锁定文件夹：${collection.title}`,
      description:
        "文件夹锁只是本地界面访问锁，不提供磁盘加密；锁定后需密码才能查看。",
      confirmLabel: "锁定",
      fields: [
        {
          name: "password",
          label: "密码",
          required: true,
          maxLength: 512,
          inputType: "password",
        },
      ],
      onSubmit: ({ password }) => store.setFolderLock(collection.id, password),
    });

  const unlock = () =>
    dialog.requestForm({
      title: `解锁文件夹：${collection.title}`,
      description: "文件夹锁只是本地界面访问锁，不提供磁盘加密。",
      confirmLabel: "解锁",
      fields: [
        {
          name: "password",
          label: "密码",
          required: true,
          maxLength: 512,
          inputType: "password",
        },
      ],
      onSubmit: ({ password }) => {
        void store.unlockFolder(collection.id, password);
      },
    });

  const remove = async () => {
    const confirmed = await dialog.requestConfirm({
      title: `删除文件夹“${collection.title}”？`,
      description:
        "将删除该文件夹及其全部子文件夹。文件夹只是整理结构，素材源文件不会被删除，已加入其它文件夹的素材不受影响。",
      confirmLabel: "删除文件夹",
      danger: true,
    });
    if (confirmed) {
      await store.deleteCollection(collection.id);
    }
  };

  return (
    <div className="folder-actions-menu" ref={menuRef}>
      <button
        className="folder-actions-trigger"
        aria-label={`${collection.title} 操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
          setMoveOpen(false);
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="folder-actions-popover" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void newSubfolder();
            }}
          >
            <FolderPlus size={15} />
            新建子文件夹
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void rename();
            }}
          >
            <Pencil size={15} />
            重命名
          </button>
          <div
            className="folder-move-item"
            onMouseEnter={() => setMoveOpen(true)}
            onMouseLeave={() => setMoveOpen(false)}
          >
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={moveOpen}
            >
              <ArrowUpToLine size={15} />
              移动到…
              <ChevronRight className="context-menu-chevron" size={14} />
            </button>
            {moveOpen && (
              <div
                className="asset-folder-submenu"
                role="menu"
                aria-label="选择目标文件夹"
              >
                <div className="folder-menu-list">
                  {collection.parentId !== null && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        setMoveOpen(false);
                        void store.updateCollection(collection.id, {
                          parentId: null,
                        });
                      }}
                    >
                      <FolderOpen size={14} />
                      移到根目录
                    </button>
                  )}
                  {moveTargets.map((target) => (
                    <button
                      role="menuitem"
                      key={target.id}
                      onClick={() => {
                        setOpen(false);
                        setMoveOpen(false);
                        void store.updateCollection(collection.id, {
                          parentId: target.id,
                        });
                      }}
                    >
                      <FolderOpen size={14} />
                      <span>{target.title}</span>
                    </button>
                  ))}
                  {!moveTargets.length && collection.parentId === null && (
                    <p>没有可移动到的目标文件夹</p>
                  )}
                </div>
              </div>
            )}
          </div>
          {collection.locked ? (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void unlock();
              }}
            >
              <LockOpen size={15} />
              解锁
            </button>
          ) : (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void lock();
              }}
            >
              <Lock size={15} />
              锁定
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void revealInExplorer();
            }}
          >
            <LocateFixed size={15} />
            在资源管理器中显示
          </button>
          <div className="folder-menu-separator" />
          <button
            className="danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void remove();
            }}
          >
            <Trash2 size={15} />
            删除
          </button>
        </div>
      )}
    </div>
  );
}
