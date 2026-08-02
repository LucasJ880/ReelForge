"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  type Locale,
  isLocale,
  normalizeLocale,
} from "./config";
import { getDictionary } from "./dictionaries";
import { translate } from "./translate";
import type { TranslationKey } from "./types";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey | string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  initialLocale?: Locale;
  children: React.ReactNode;
}

export function I18nProvider({ initialLocale, children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(
    initialLocale ?? DEFAULT_LOCALE,
  );

  // 与 RSC 一致：以 cookie（= 服务端 initialLocale）为准，避免 localStorage 与页面语言错位
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cookie = readCookie(LOCALE_COOKIE);
    const resolved: Locale = isLocale(cookie)
      ? cookie
      : (initialLocale ?? DEFAULT_LOCALE);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, resolved);
    } catch {
      /// localStorage 可能被禁用
    }
    if (resolved !== locale) {
      setLocaleState(resolved);
    }
    syncHtmlLang(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
        } catch {
          /// ignore
        }
        writeCookie(LOCALE_COOKIE, next);
        syncHtmlLang(next);
        /**
         * 整页 reload 而不是 router.refresh()：
         * 生产（next start）实测 refresh() 被静默吞掉 —— 点击后没有任何
         * 对当前路由的 RSC 请求发出，页面文案停在旧语言；偶尔生效时还会
         * 与上一次切换竞态（旧语言的响应后到，覆盖新选择）。dev 模式正常，
         * 所以这个 bug 只在线上暴露。切语言是低频且刻意的操作，
         * reload 是保证所有 RSC 段落一致换语言的最稳做法（行业通行）。
         */
        window.location.reload();
      }
    },
    [],
  );

  const dict = useMemo(() => getDictionary(locale), [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(dict, key, params),
    }),
    [locale, setLocale, dict],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    /// 在没有 Provider 包裹的渲染场景下回退到默认 locale，避免崩溃
    const dict = getDictionary(DEFAULT_LOCALE);
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key, params) => translate(dict, key, params),
    };
  }
  return ctx;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)"),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${oneYear}; path=/; SameSite=Lax`;
}

function syncHtmlLang(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = normalizeLocale(locale);
}
