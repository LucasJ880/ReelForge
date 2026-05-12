import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale, normalizeLocale } from "./config";
import { getDictionary } from "./dictionaries";
import { translate } from "./translate";
import type { TranslationKey } from "./types";

/**
 * RSC 端读取 locale。
 *
 * Next.js 16 中 `cookies()` 是异步的，但为了让同步 RSC 渲染也能访问，
 * 这里同时导出 sync 与 async 两个版本。
 */
export async function getServerLocale(): Promise<Locale> {
  try {
    const store = await cookies();
    const value = store.get(LOCALE_COOKIE)?.value;
    return normalizeLocale(value);
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function getServerTranslator() {
  const locale = await getServerLocale();
  const dict = getDictionary(locale);
  return {
    locale,
    t: (key: TranslationKey | string, params?: Record<string, string | number>) =>
      translate(dict, key, params),
  };
}
