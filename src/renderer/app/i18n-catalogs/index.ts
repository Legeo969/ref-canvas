import type { AppLanguage } from "../../../shared/contracts";
import type { MessageKey } from "../i18n";
import { catalog as shellCatalog } from "./shell";
import { catalog as directoryCatalog } from "./directory";
import { catalog as boardCatalog } from "./board";
import { catalog as collectionsCatalog } from "./collections";
import { catalog as previewMediaCatalog } from "./preview-media";
import { catalog as aiCatalog } from "./ai";
import { catalog as settingsCatalog } from "./settings";
import { catalog as commonCatalog } from "./common";

type Catalog = Record<MessageKey, string>;
const fragments = [shellCatalog, directoryCatalog, boardCatalog, collectionsCatalog, previewMediaCatalog, aiCatalog, settingsCatalog, commonCatalog] as const;
type FragmentLanguage = "en" | "zhCN";
const merge = (language: FragmentLanguage): Partial<Catalog> =>
  Object.assign({}, ...fragments.map((fragment) => fragment[language]));
const en = merge("en") as Catalog;
export const catalogsByLanguage: Record<AppLanguage, Catalog> = {
  en,
  "zh-CN": { ...en, ...merge("zhCN") },
};
export const catalogKeySetsByLanguage = (): Record<AppLanguage, string[]> => ({
  "zh-CN": Object.keys(catalogsByLanguage["zh-CN"]),
  en: Object.keys(catalogsByLanguage.en),
});
