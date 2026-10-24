import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import { getPublicPageCopy } from "../src/i18n/public-copy";
import { getGrowthCopy } from "../src/i18n/growth-copy";
import { zhCN } from "../src/i18n/dictionaries/zh-CN";
import { enUS } from "../src/i18n/dictionaries/en-US";
import { TEMPLATE_LIBRARY_COPY } from "../src/components/templates/template-library-copy";
import type { Locale } from "../src/i18n/config";

/**
 * 1025 · B2.5 文案门禁：客户看得见的文案不许出现内部术语，英文界面不许出现中文。
 *
 * 禁词来自 UI 审计 P1-12：内部模型名（Image 2）、英文混排的 workspace / 套餐 id、旧 TTS、
 * 青砚（内部发布系统）、提示词原文标题（NEGATIVE PROMPT）、环境变量名（NEXT_PUBLIC_）。
 */

type Entry = { path: string; value: string };

function strings(value: unknown, path: string, out: Entry[] = []): Entry[] {
  if (typeof value === "string") out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) strings(child, `${path}.${key}`, out);
  }
  return out;
}

/** 两种语言都禁。 */
const BANNED_ANY: RegExp[] = [
  /Image 2/,
  /NEGATIVE PROMPT/i,
  /NEXT_PUBLIC_/,
  /旧 TTS|legacy TTS/i,
  /青砚|Qingyan/i,
];
/** 中文界面里不许夹英文内部词：workspace（工作区）、套餐原始 id（starter / studio）。 */
const BANNED_ZH: RegExp[] = [/\bworkspace\b/i, /\bstarter\b/, /\bstudio\b/];

const CJK = /[㐀-鿿！-｠　-〿]/;

function customerCopy(locale: Locale): Record<string, unknown> {
  return {
    platform: getPlatformCopy(locale),
    public: getPublicPageCopy(locale),
    growth: getGrowthCopy(locale),
    templates: TEMPLATE_LIBRARY_COPY[locale],
    dictionary: locale === "zh-CN" ? zhCN : enUS,
  };
}

/** 平台运营面（内部线路选择器）只对运营可见，不在客户门禁里。 */
const OPERATOR_ONLY = /^\.platform\.create\.videoRoutes\./;

test("客户可见文案过禁词表（中英两套）", () => {
  const offenders: string[] = [];
  for (const locale of ["zh-CN", "en-US"] as const) {
    for (const { path, value } of strings(customerCopy(locale), "")) {
      if (OPERATOR_ONLY.test(path)) continue;
      const rules = locale === "zh-CN" ? [...BANNED_ANY, ...BANNED_ZH] : BANNED_ANY;
      for (const rule of rules) {
        if (rule.test(value)) offenders.push(`${locale}${path}: ${value.slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("英文界面的文案里没有中文（语言切换器上的「中文」是目标语言的自称，除外）", () => {
  const ALLOWED = new Set([".growth.leadPage.switchLocale"]);
  const offenders = strings(customerCopy("en-US"), "")
    .filter(({ path, value }) => !ALLOWED.has(path) && CJK.test(value))
    .map(({ path, value }) => `${path}: ${value.slice(0, 40)}`);
  assert.deepEqual(offenders, []);
});

/** 组件里内联的中英文案（studio 的 ZH/EN_COPY、品牌页、批次详情等）也过同一张禁词表。 */
const CUSTOMER_SOURCES = [
  "src/components/video-generation/streamlined-video-studio.tsx",
  "src/components/video-generation/first-run-onboarding-dialog.tsx",
  "src/components/video-generation/storyboard-workflow-panel.tsx",
  "src/components/video-generation/audio-caption-controls.tsx",
  "src/components/product-images/product-image-studio.tsx",
  "src/components/batch/batch-monitor.tsx",
  "src/components/brand/brand-package-manager.tsx",
  "src/components/brand/product-anchor-manager.tsx",
  "src/components/brand/customer-brand-wall.tsx",
  "src/components/templates/template-recipe-dialog.tsx",
  "src/components/templates/template-library-grid.tsx",
  "src/components/content-plan/plan-timeline.tsx",
  "src/components/wins/dimension-ledger.tsx",
  "src/app/(platform)/app/library/[id]/page.tsx",
  "src/app/(public)/privacy/page.tsx",
  "src/app/(public)/terms/page.tsx",
  "src/app/not-found.tsx",
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

test("客户面组件源码（去掉注释后）不含内部术语", () => {
  const offenders: string[] = [];
  for (const file of CUSTOMER_SOURCES) {
    /// 读环境变量本身是代码，不是文案：只查剩下的部分有没有把变量名写给客户看
    const code = stripComments(readFileSync(file, "utf8")).replace(/process\.env\.NEXT_PUBLIC_\w+/g, "");
    for (const rule of [...BANNED_ANY, /当前 workspace/, /项目后即可使用/, /Negative Prompt/]) {
      if (rule.test(code)) offenders.push(`${file}: ${rule}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("创作台的英文文案块不含中文", () => {
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  const start = studio.indexOf("const EN_COPY: StudioCopy = {");
  const end = studio.indexOf("\n};", start);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(stripComments(studio.slice(start, end)), CJK);
});
