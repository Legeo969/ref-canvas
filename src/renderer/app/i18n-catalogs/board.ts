import type { MessageKey } from "../i18n";

export const catalog = {
  en: {
    "boards.unavailable": "Could not open the board",
    "boards.new": "New Board",
    "boards.createConfirm": "Create",
    "boards.nameLabel": "Board name",
  },
  zhCN: {
    "boards.unavailable": "无法打开白板",
    "boards.new": "新建白板",
    "boards.createConfirm": "创建",
    "boards.nameLabel": "白板名称",
  },
} satisfies Record<string, Partial<Record<MessageKey, string>>>;
