/**
 * 内部 i18n runtime（FND-011）。
 *
 * - 七语言 catalog（zh-CN / zh-TW / en / ja / ko / es / fr）。
 * - 英文为回退基准；任何语言缺失 key 时回退英文，绝不显示 raw key。
 * - 开发期：收集缺失 key 上报 console（缺 key 报告）。
 * - 语言选择存主进程 settings（AppPreferences.language），切换即时生效。
 */
import type { AppLanguage } from "../../shared/contracts";
import { useEffect, useState } from "react";

/** 应用语言 Hook：初始化时从 preferences 读取，监听切换事件即时生效。 */
export function useAppLanguage(): AppLanguage {
  const [language, setLanguageState] = useState<AppLanguage>("en");

  useEffect(() => {
    let cancelled = false;
    try {
      void window.refCanvas.system
        .getPreferences()
        .then((preferences) => {
          if (!cancelled && preferences.language) {
            setLanguage(preferences.language);
            setLanguageState(preferences.language);
            document.documentElement.lang = preferences.language;
          }
        })
        .catch(() => undefined);
    } catch {
      // 测试或受限环境没有完整 preload API：保持默认。
    }
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<AppLanguage>).detail;
      if (next) {
        setLanguage(next);
        setLanguageState(next);
        document.documentElement.lang = next;
      }
    };
    window.addEventListener("refcanvas:language-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("refcanvas:language-changed", onChange);
    };
  }, []);

  return language;
}

export const APP_LANGUAGES: Array<{ code: AppLanguage; label: string }> = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
];

export type MessageKey =
  | "app.name"
  | "workspace.disk"
  | "workspace.board"
  | "sidebar.quickAccess"
  | "sidebar.drives"
  | "sidebar.collections"
  | "sidebar.boards"
  | "sidebar.recycleBin"
  | "collections.empty"
  | "collections.create"
  | "collections.addFiles"
  | "collections.newChild"
  | "collections.rename"
  | "collections.delete"
  | "collections.export"
  | "collections.resolve"
  | "collections.exporting"
  | "collections.exported"
  | "preview.open"
  | "preview.reveal"
  | "preview.floating"
  | "preview.close"
  | "tasks.title"
  | "tasks.empty"
  | "ai.title"
  | "ai.source"
  | "ai.references"
  | "ai.prompt"
  | "ai.majorChange"
  | "ai.outputCount"
  | "ai.outputDirectory"
  | "ai.provider"
  | "ai.generate"
  | "ai.cancel"
  | "ai.retry"
  | "ai.history"
  | "ai.noJobs"
  | "settings.title"
  | "settings.language"
  | "status.diskReady"
  | "status.boardReady"
  | "status.importing";

type Catalog = Record<MessageKey, string>;

const zhCN: Catalog = {
  "app.name": "RefCanvas",
  "workspace.disk": "磁盘",
  "workspace.board": "参考板",
  "sidebar.quickAccess": "快速访问",
  "sidebar.drives": "磁盘",
  "sidebar.collections": "引用集合",
  "sidebar.boards": "参考板",
  "sidebar.recycleBin": "回收站",
  "collections.empty": "还没有集合。点击 + 创建引用集合，或拖入文件。",
  "collections.create": "新建集合",
  "collections.addFiles": "添加文件…",
  "collections.newChild": "新建子集合",
  "collections.rename": "重命名",
  "collections.delete": "删除集合",
  "collections.export": "导出…",
  "collections.resolve": "重新解析",
  "collections.exporting": "导出中…",
  "collections.exported": "导出完成",
  "preview.open": "打开",
  "preview.reveal": "在资源管理器中显示",
  "preview.floating": "浮动预览",
  "preview.close": "关闭",
  "tasks.title": "任务中心",
  "tasks.empty": "暂无任务。",
  "ai.title": "AI 设计",
  "ai.source": "源图",
  "ai.references": "参考图",
  "ai.prompt": "提示词",
  "ai.majorChange": "重大改动",
  "ai.outputCount": "输出数量",
  "ai.outputDirectory": "输出目录",
  "ai.provider": "Provider",
  "ai.generate": "生成方案",
  "ai.cancel": "取消",
  "ai.retry": "重试",
  "ai.history": "任务历史",
  "ai.noJobs": "还没有任务。",
  "settings.title": "设置",
  "settings.language": "界面语言",
  "status.diskReady": "磁盘浏览已就绪",
  "status.boardReady": "参考板已就绪",
  "status.importing": "正在更新文件索引…",
};

const zhTW: Catalog = {
  ...zhCN,
  "workspace.disk": "磁碟",
  "workspace.board": "參考板",
  "sidebar.quickAccess": "快速存取",
  "sidebar.drives": "磁碟",
  "sidebar.collections": "引用集合",
  "sidebar.boards": "參考板",
  "sidebar.recycleBin": "資源回收筒",
  "collections.empty": "還沒有集合。點擊 + 建立引用集合，或拖入檔案。",
  "collections.create": "新建集合",
  "collections.addFiles": "新增檔案…",
  "collections.newChild": "新增子集合",
  "collections.rename": "重新命名",
  "collections.delete": "刪除集合",
  "collections.export": "匯出…",
  "collections.resolve": "重新解析",
  "collections.exporting": "匯出中…",
  "collections.exported": "匯出完成",
  "preview.open": "開啟",
  "preview.reveal": "在檔案總管中顯示",
  "preview.floating": "浮動預覽",
  "preview.close": "關閉",
  "tasks.title": "任務中心",
  "tasks.empty": "目前沒有任務。",
  "ai.title": "AI 設計",
  "ai.source": "來源圖",
  "ai.references": "參考圖",
  "ai.prompt": "提示詞",
  "ai.majorChange": "重大變更",
  "ai.outputCount": "輸出數量",
  "ai.outputDirectory": "輸出目錄",
  "ai.provider": "Provider",
  "ai.generate": "產生方案",
  "ai.cancel": "取消",
  "ai.retry": "重試",
  "ai.history": "任務記錄",
  "ai.noJobs": "尚無任務。",
  "settings.title": "設定",
  "settings.language": "介面語言",
  "status.diskReady": "磁碟瀏覽已就緒",
  "status.boardReady": "參考板已就緒",
  "status.importing": "正在更新檔案索引…",
};

const en: Catalog = {
  "app.name": "RefCanvas",
  "workspace.disk": "Disk",
  "workspace.board": "Boards",
  "sidebar.quickAccess": "Quick Access",
  "sidebar.drives": "Drives",
  "sidebar.collections": "Collections",
  "sidebar.boards": "Boards",
  "sidebar.recycleBin": "Recycle Bin",
  "collections.empty": "No collections yet. Click + to create a reference collection, or drop files in.",
  "collections.create": "New Collection",
  "collections.addFiles": "Add Files…",
  "collections.newChild": "New Child Collection",
  "collections.rename": "Rename",
  "collections.delete": "Delete Collection",
  "collections.export": "Export…",
  "collections.resolve": "Re-resolve",
  "collections.exporting": "Exporting…",
  "collections.exported": "Export Complete",
  "preview.open": "Open",
  "preview.reveal": "Show in File Explorer",
  "preview.floating": "Floating Preview",
  "preview.close": "Close",
  "tasks.title": "Task Center",
  "tasks.empty": "No tasks yet.",
  "ai.title": "AI Design",
  "ai.source": "Source",
  "ai.references": "References",
  "ai.prompt": "Prompt",
  "ai.majorChange": "Major change",
  "ai.outputCount": "Output count",
  "ai.outputDirectory": "Output directory",
  "ai.provider": "Provider",
  "ai.generate": "Generate",
  "ai.cancel": "Cancel",
  "ai.retry": "Retry",
  "ai.history": "History",
  "ai.noJobs": "No jobs yet.",
  "settings.title": "Settings",
  "settings.language": "Language",
  "status.diskReady": "Disk browsing ready",
  "status.boardReady": "Boards ready",
  "status.importing": "Updating file index…",
};

const ja: Catalog = {
  ...en,
  "workspace.disk": "ディスク",
  "workspace.board": "ボード",
  "sidebar.quickAccess": "クイックアクセス",
  "sidebar.drives": "ドライブ",
  "sidebar.collections": "コレクション",
  "sidebar.boards": "ボード",
  "sidebar.recycleBin": "ゴミ箱",
  "collections.empty": "コレクションはまだありません。+ をクリックして作成、またはファイルをドロップしてください。",
  "collections.create": "新規コレクション",
  "collections.addFiles": "ファイルを追加…",
  "collections.newChild": "子コレクションを作成",
  "collections.rename": "名前を変更",
  "collections.delete": "コレクションを削除",
  "collections.export": "書き出し…",
  "collections.resolve": "再解決",
  "collections.exporting": "書き出し中…",
  "collections.exported": "書き出し完了",
  "preview.open": "開く",
  "preview.reveal": "エクスプローラーで表示",
  "preview.floating": "フローティングプレビュー",
  "preview.close": "閉じる",
  "tasks.title": "タスクセンター",
  "tasks.empty": "タスクはまだありません。",
  "ai.title": "AI デザイン",
  "ai.source": "ソース画像",
  "ai.references": "参照画像",
  "ai.prompt": "プロンプト",
  "ai.majorChange": "大幅な変更",
  "ai.outputCount": "出力数",
  "ai.outputDirectory": "出力先フォルダ",
  "ai.provider": "プロバイダー",
  "ai.generate": "生成",
  "ai.cancel": "キャンセル",
  "ai.retry": "再試行",
  "ai.history": "履歴",
  "ai.noJobs": "ジョブはまだありません。",
  "settings.title": "設定",
  "settings.language": "言語",
  "status.diskReady": "ディスク閲覧準備完了",
  "status.boardReady": "ボード準備完了",
  "status.importing": "ファイルインデックスを更新中…",
};

const ko: Catalog = {
  ...en,
  "workspace.disk": "디스크",
  "workspace.board": "보드",
  "sidebar.quickAccess": "빠른 액세스",
  "sidebar.drives": "드라이브",
  "sidebar.collections": "컬렉션",
  "sidebar.boards": "보드",
  "sidebar.recycleBin": "휴지통",
  "collections.empty": "아직 컬렉션이 없습니다. + 를 눌러 만들거나 파일을 끌어 놓으세요.",
  "collections.create": "새 컬렉션",
  "collections.addFiles": "파일 추가…",
  "collections.newChild": "하위 컬렉션 만들기",
  "collections.rename": "이름 바꾸기",
  "collections.delete": "컬렉션 삭제",
  "collections.export": "내보내기…",
  "collections.resolve": "다시 해석",
  "collections.exporting": "내보내는 중…",
  "collections.exported": "내보내기 완료",
  "preview.open": "열기",
  "preview.reveal": "파일 탐색기에 표시",
  "preview.floating": "플로팅 미리보기",
  "preview.close": "닫기",
  "tasks.title": "작업 센터",
  "tasks.empty": "아직 작업이 없습니다.",
  "ai.title": "AI 디자인",
  "ai.source": "소스 이미지",
  "ai.references": "참조 이미지",
  "ai.prompt": "프롬프트",
  "ai.majorChange": "대폭 변경",
  "ai.outputCount": "출력 수",
  "ai.outputDirectory": "출력 폴더",
  "ai.provider": "공급자",
  "ai.generate": "생성",
  "ai.cancel": "취소",
  "ai.retry": "재시도",
  "ai.history": "기록",
  "ai.noJobs": "아직 작업이 없습니다.",
  "settings.title": "설정",
  "settings.language": "언어",
  "status.diskReady": "디스크 탐색 준비 완료",
  "status.boardReady": "보드 준비 완료",
  "status.importing": "파일 색인 업데이트 중…",
};

const es: Catalog = {
  ...en,
  "workspace.disk": "Disco",
  "workspace.board": "Paneles",
  "sidebar.quickAccess": "Acceso rápido",
  "sidebar.drives": "Unidades",
  "sidebar.collections": "Colecciones",
  "sidebar.boards": "Paneles",
  "sidebar.recycleBin": "Papelera",
  "collections.empty": "Aún no hay colecciones. Pulsa + para crear una o suelta archivos aquí.",
  "collections.create": "Nueva colección",
  "collections.addFiles": "Añadir archivos…",
  "collections.newChild": "Nueva subcolección",
  "collections.rename": "Renombrar",
  "collections.delete": "Eliminar colección",
  "collections.export": "Exportar…",
  "collections.resolve": "Resolver de nuevo",
  "collections.exporting": "Exportando…",
  "collections.exported": "Exportación completa",
  "preview.open": "Abrir",
  "preview.reveal": "Mostrar en el explorador",
  "preview.floating": "Vista flotante",
  "preview.close": "Cerrar",
  "tasks.title": "Centro de tareas",
  "tasks.empty": "Aún no hay tareas.",
  "ai.title": "Diseño IA",
  "ai.source": "Imagen de origen",
  "ai.references": "Imágenes de referencia",
  "ai.prompt": "Indicación",
  "ai.majorChange": "Cambio importante",
  "ai.outputCount": "Número de salidas",
  "ai.outputDirectory": "Carpeta de salida",
  "ai.provider": "Proveedor",
  "ai.generate": "Generar",
  "ai.cancel": "Cancelar",
  "ai.retry": "Reintentar",
  "ai.history": "Historial",
  "ai.noJobs": "Aún no hay trabajos.",
  "settings.title": "Ajustes",
  "settings.language": "Idioma",
  "status.diskReady": "Exploración de disco lista",
  "status.boardReady": "Paneles listos",
  "status.importing": "Actualizando el índice…",
};

const fr: Catalog = {
  ...en,
  "workspace.disk": "Disque",
  "workspace.board": "Tableaux",
  "sidebar.quickAccess": "Accès rapide",
  "sidebar.drives": "Lecteurs",
  "sidebar.collections": "Collections",
  "sidebar.boards": "Tableaux",
  "sidebar.recycleBin": "Corbeille",
  "collections.empty": "Aucune collection. Cliquez sur + pour en créer une, ou déposez des fichiers ici.",
  "collections.create": "Nouvelle collection",
  "collections.addFiles": "Ajouter des fichiers…",
  "collections.newChild": "Nouvelle sous-collection",
  "collections.rename": "Renommer",
  "collections.delete": "Supprimer la collection",
  "collections.export": "Exporter…",
  "collections.resolve": "Re-résoudre",
  "collections.exporting": "Exportation…",
  "collections.exported": "Exportation terminée",
  "preview.open": "Ouvrir",
  "preview.reveal": "Afficher dans l'explorateur",
  "preview.floating": "Aperçu flottant",
  "preview.close": "Fermer",
  "tasks.title": "Centre de tâches",
  "tasks.empty": "Aucune tâche pour le moment.",
  "ai.title": "Conception IA",
  "ai.source": "Image source",
  "ai.references": "Images de référence",
  "ai.prompt": "Invite",
  "ai.majorChange": "Changement majeur",
  "ai.outputCount": "Nombre de sorties",
  "ai.outputDirectory": "Dossier de sortie",
  "ai.provider": "Fournisseur",
  "ai.generate": "Générer",
  "ai.cancel": "Annuler",
  "ai.retry": "Réessayer",
  "ai.history": "Historique",
  "ai.noJobs": "Aucun travail pour le moment.",
  "settings.title": "Paramètres",
  "settings.language": "Langue",
  "status.diskReady": "Parcours du disque prêt",
  "status.boardReady": "Tableaux prêts",
  "status.importing": "Mise à jour de l'index…",
};

const CATALOGS: Record<AppLanguage, Catalog> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
  ja,
  ko,
  es,
  fr,
};

let currentLanguage: AppLanguage = "en";

export function setLanguage(language: AppLanguage): void {
  currentLanguage = language;
}

export function getLanguage(): AppLanguage {
  return currentLanguage;
}

export function translate(key: MessageKey): string {
  const catalog = CATALOGS[currentLanguage];
  const value = catalog?.[key];
  if (value !== undefined && value !== "") return value;
  // 缺失 key：回退英文；开发期报告缺 key。
  if (import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing key "${key}" in "${currentLanguage}"`);
  }
  return CATALOGS.en[key] ?? key;
}
