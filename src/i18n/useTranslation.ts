"use client";

import { useI18n } from "./I18nProvider";

export function useTranslation() {
  const { t, locale, setLocale } = useI18n();
  return { t, locale, setLocale };
}
