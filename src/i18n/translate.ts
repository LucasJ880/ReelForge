import type { Dictionary, TranslationKey } from "./types";

/**
 * 在字典里按 dot 路径取值；缺失时返回 key 本身（便于 dev 中肉眼发现漏翻）。
 */
export function lookup(dict: Dictionary, key: string): string {
  const parts = key.split(".");
  let cursor: unknown = dict;
  for (const part of parts) {
    if (cursor && typeof cursor === "object" && part in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof cursor === "string" ? cursor : key;
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      return String(params[name]);
    }
    return match;
  });
}

export function translate(
  dict: Dictionary,
  key: TranslationKey | string,
  params?: Record<string, string | number>,
): string {
  return interpolate(lookup(dict, key), params);
}
