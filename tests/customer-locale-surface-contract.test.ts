import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getPlatformCopy } from "../src/i18n/platform-copy";

const shell = readFileSync(
  "src/components/platform/platform-shell.tsx",
  "utf8",
);
const monitor = readFileSync(
  "src/components/batch/batch-monitor.tsx",
  "utf8",
);
const wizard = readFileSync(
  "src/components/batch/batch-create-wizard.tsx",
  "utf8",
);

test("390px /app shell exposes the same locale switcher as desktop", () => {
  assert.equal(
    (shell.match(/<LanguageSwitcher/g) ?? []).length,
    2,
    "desktop sidebar and mobile header must each expose a language switcher",
  );
  assert.match(
    shell,
    /className="shrink-0 md:hidden" data-mobile-language-switcher/,
  );
  assert.match(
    shell,
    /data-mobile-language-switcher>[\s\S]{0,240}variant="inline"/,
  );
});

test("batch monitor localizes titles, statuses, recovery copy, and template names", () => {
  const english = getPlatformCopy("en-US").batches;
  const chinese = getPlatformCopy("zh-CN").batches;

  assert.equal(english.monitor.kicker, "BATCH MONITOR");
  assert.equal(chinese.monitor.kicker, "批次监控");
  assert.equal(english.statuses.PAUSED, "Paused");
  assert.equal(chinese.statuses.PAUSED, "已暂停");
  assert.match(
    monitor,
    /english \? batch\.template\.name : batch\.template\.nameZh/,
  );
  assert.match(monitor, /monitorCopy\.paused\.replace/);
  assert.doesNotMatch(monitor, /\{batch\.statusReason\}/);
  /// 服务端失败原因是已脱敏的中文 userSafeError；只允许 zh-CN 界面直渲，
  /// 英文界面必须继续走本地化 copy 映射。
  assert.match(
    monitor,
    /if \(!english && job\.error\?\.message\) return job\.error\.message;/,
    "the sanitized server reason may only render behind the zh-CN guard",
  );
  assert.equal(
    (monitor.match(/error\?\.message/g) ?? []).length,
    1,
    "no other raw error.message rendering is allowed in the monitor",
  );
  assert.doesNotMatch(monitor, /detailJob\.error\.message/);
  assert.doesNotMatch(monitor, /data\.error\s*\?\?/);
});

test("batch wizard uses locale copy for backend category identifiers", () => {
  const englishCategories = getPlatformCopy("en-US").templates.categories;
  assert.equal(englishCategories["爆款广告"], "Performance ads");
  assert.equal(englishCategories["食品饮料"], "Food & beverage");
  assert.match(wizard, /getPlatformCopy\(locale\)\.templates/);
  assert.ok(
    (wizard.match(/categoryLabel\(/g) ?? []).length >= 5,
    "filter, search, list card, and selected template must use the category map",
  );
  assert.doesNotMatch(wizard, />\{template\.category\}/);
  assert.doesNotMatch(wizard, />\{selectedTemplate\.category\}/);
});
