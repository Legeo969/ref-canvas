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
type FragmentLanguage = "en" | "zhCN" | "zhTW" | "ja" | "ko" | "es" | "fr";
const merge = (language: FragmentLanguage): Partial<Catalog> =>
  Object.assign({}, ...fragments.map((fragment) => fragment[language]));
const en = merge("en") as Catalog;
export const catalogsByLanguage: Record<AppLanguage, Catalog> = {
  en,
  "zh-CN": { ...en, ...merge("zhCN") },
  "zh-TW": { ...en, ...merge("zhTW") },
  ja: { ...en, ...merge("ja") },
  ko: { ...en, ...merge("ko") },
  es: { ...en, ...merge("es") },
  fr: { ...en, ...merge("fr") },
};
export const catalogKeySetsByLanguage = (): Record<AppLanguage, string[]> => ({
  "zh-CN": Object.keys(catalogsByLanguage["zh-CN"]),
  "zh-TW": Object.keys(catalogsByLanguage["zh-TW"]),
  en: Object.keys(catalogsByLanguage.en),
  ja: Object.keys(catalogsByLanguage.ja),
  ko: Object.keys(catalogsByLanguage.ko),
  es: Object.keys(catalogsByLanguage.es),
  fr: Object.keys(catalogsByLanguage.fr),
});
