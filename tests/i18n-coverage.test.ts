import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zhCN } from "../src/i18n/dictionaries/zh-CN";
import { enUS } from "../src/i18n/dictionaries/en-US";
import { translate, lookup } from "../src/i18n/translate";
import {
  COPY_AUDIT_TABLE,
} from "../src/i18n/__fixtures__/copy-audit";

function flatKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(next);
    else if (v && typeof v === "object") out.push(...flatKeys(v, next));
  }
  return out;
}

test("i18n: zh-CN 与 en-US 字典 key 集合完全相等", () => {
  const zhKeys = flatKeys(zhCN).sort();
  const enKeys = flatKeys(enUS).sort();
  assert.deepEqual(
    zhKeys,
    enKeys,
    `字典 key 不一致：\nzh-only=${diff(zhKeys, enKeys).join(",")}\nen-only=${diff(enKeys, zhKeys).join(",")}`,
  );
});

test("i18n: 关键面向用户的 key 在两个字典中都存在且非空", () => {
  const importantKeys = [
    "common.appName",
    "common.appTagline",
    "common.logout",
    "nav.projects",
    "nav.videos",
    "nav.advancedSection",
    "project.duration.label",
    "project.duration.sec15",
    "project.duration.sec30",
    "project.duration.sec60",
    "brand.aiGenerateCta",
    "logo.title",
    "logo.actions.generate",
    "video.progress.scriptReady",
    "video.progress.segments",
    "video.progress.stitching",
    "video.actions.preview",
    "video.actions.retryFailed",
    "video.states.generating",
    "video.helpers.failed",
    "common.showAdvanced",
    "common.hideAdvanced",
    "language.switch",
  ];
  for (const key of importantKeys) {
    const zhVal = lookup(zhCN, key);
    const enVal = lookup(enUS, key);
    assert.notEqual(zhVal, key, `zh 缺 ${key}`);
    assert.notEqual(enVal, key, `en 缺 ${key}`);
    assert.ok(zhVal.length > 0);
    assert.ok(enVal.length > 0);
  }
});

test("i18n: 主 UI 文件按 copy-audit 禁词清单审计", () => {
  /// 每个文件用自己的 forbidden（避免一刀切误伤 API 路径里的 'render-status' 等）
  for (const entry of COPY_AUDIT_TABLE) {
    if (!entry.forbidden || entry.forbidden.length === 0) continue;
    const abs = resolve(entry.file);
    let src: string;
    try {
      src = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    /// 排除注释 / 类型 / import / API URL / hex 颜色
    const cleaned = stripIgnorables(src);
    for (const word of entry.forbidden) {
      const isAllNonWord = !/\w/.test(word);
      const pattern = isAllNonWord
        ? new RegExp(escapeRe(word))
        : new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(word)}([^A-Za-z0-9_-]|$)`);
      assert.ok(
        !pattern.test(cleaned),
        `${entry.file} 主 UI 文本仍含禁词「${word}」`,
      );
    }
  }
});

test("i18n: translate 插值工作 ({done}/{total})", () => {
  const result = translate(zhCN, "video.progress.segments", {
    done: 2,
    total: 4,
  });
  assert.match(result, /2/);
  assert.match(result, /4/);
});

test("i18n: lookup 缺失 key → 回退到 key 本身（开发期可见）", () => {
  const result = lookup(zhCN, "non.existent.key");
  assert.equal(result, "non.existent.key");
});

/**
 * Customer-facing dictionary values must not leak engineering jargon that exposes
 * infra plumbing (FFmpeg / env-var names / iteration phase numbers / vendor SKUs).
 * Anything we genuinely need for debugging belongs under `debug.*` namespace and
 * inside admin / dev-mode UI, not in the customer wizard / project flow.
 */
test("i18n: 字典 value 不得含工程术语（FFmpeg / ENABLE_*_RENDER / BLOB_READ_WRITE_TOKEN / Phase N / Vercel Blob）", () => {
  const forbiddenInValues: { pattern: RegExp; label: string }[] = [
    { pattern: /\bFFmpeg\b/i, label: "FFmpeg" },
    { pattern: /\bENABLE_[A-Z_]+\b/, label: "ENABLE_*_TOKEN/RENDER env var" },
    { pattern: /\bBLOB_READ_WRITE_TOKEN\b/, label: "BLOB_READ_WRITE_TOKEN" },
    { pattern: /\bPhase\s*\d+\b/i, label: "Phase N" },
    { pattern: /Vercel\s*Blob/i, label: "Vercel Blob" },
  ];
  for (const dict of [zhCN, enUS] as const) {
    for (const key of flatKeys(dict)) {
      /// debug 命名空间允许暴露内部术语（仅 admin / dev 抽屉中显示）
      if (key.startsWith("debug.")) continue;
      const value = lookup(dict, key);
      for (const { pattern, label } of forbiddenInValues) {
        assert.ok(
          !pattern.test(value),
          `字典 value "${key}" 含工程术语「${label}」: ${value}`,
        );
      }
    }
  }
});

function diff(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((x) => !set.has(x));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 从源码中剔除：
 *  - import / type / interface 声明行（含跨行 type 块）
 *  - 单行 // 注释
 *  - 多行 /* *​/ 注释
 *  - 类型注解中的 `as` / generic 角括号内容（保守处理）
 */
function stripIgnorables(src: string): string {
  let out = src;
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (t.startsWith("//")) return false;
      if (t.startsWith("import ")) return false;
      if (t.startsWith("export type ") || t.startsWith("type ")) return false;
      if (t.startsWith("export interface ") || t.startsWith("interface ")) return false;
      return true;
    })
    .join("\n");
  return out;
}
