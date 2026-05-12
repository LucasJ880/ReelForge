export { I18nProvider, useI18n } from "./I18nProvider";
export { useTranslation } from "./useTranslation";
export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  LOCALE_STORAGE_KEY,
  LOCALES,
  isLocale,
  normalizeLocale,
} from "./config";
export type { Locale } from "./config";
export type { Dictionary, TranslationKey } from "./types";
export { translate, lookup, interpolate } from "./translate";
export { getDictionary, DICTIONARIES } from "./dictionaries";
