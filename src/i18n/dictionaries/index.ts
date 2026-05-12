import type { Dictionary } from "../types";
import { zhCN } from "./zh-CN";
import { enUS } from "./en-US";
import type { Locale } from "../config";

export const DICTIONARIES: Record<Locale, Dictionary> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES["zh-CN"];
}
