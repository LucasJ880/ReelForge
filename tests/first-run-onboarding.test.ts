import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getPlatformCopy } from "../src/i18n/platform-copy";

const DIALOG_PATH = "src/components/video-generation/first-run-onboarding-dialog.tsx";
const STUDIO_PATH = "src/components/video-generation/streamlined-video-studio.tsx";
const SHELL_PATH = "src/components/platform/platform-shell.tsx";
const CREATE_PAGE_PATH = "src/app/(platform)/app/create/page.tsx";

test("首启引导弹层：共享 Dialog（Esc 关闭 = 跳过、焦点陷阱），步骤与页内流程同源、中英双语", async () => {
  const dialog = await readFile(DIALOG_PATH, "utf8");
  assert.match(dialog, /data-testid="first-run-onboarding"/);
  // 1025 · B2.8：不再手写 role="dialog" 的 div（Esc 关不掉、没有焦点陷阱）
  assert.match(dialog, /from "@\/components\/ui\/dialog"/);
  assert.doesNotMatch(dialog, /role="dialog"/);
  assert.match(dialog, /onOpenChange=\{\(next\) => \{\s*if \(!next\) onSkip\(\);/);
  // 步骤只有一个来源：platform-copy 的 create.flowSteps，标题里的步数按步骤数填
  assert.match(dialog, /create\.flowSteps/);
  assert.match(dialog, /copy\.title\.replace\("\{n\}", String\(steps\.length\)\)/);
  assert.doesNotMatch(dialog, /STEPS_ZH|STEPS_EN/);

  const zh = getPlatformCopy("zh-CN").create;
  const en = getPlatformCopy("en-US").create;
  assert.equal(zh.flowSteps.length, 5);
  assert.equal(en.flowSteps.length, zh.flowSteps.length);
  assert.equal(zh.onboarding.title.replace("{n}", String(zh.flowSteps.length)), "5 步出第一条成片");
  assert.equal(en.onboarding.title.replace("{n}", String(en.flowSteps.length)), "5 steps to your first video");
  assert.equal(zh.onboarding.keepHints, "在页面保留简短的新手提示");
  assert.equal(en.onboarding.keepHints, "Keep short hints on the page");
  assert.equal(zh.onboarding.skip, "跳过");
  assert.equal(zh.onboarding.start, "开始创作");
});

test("创作流程步数处处一致：提示条写五步、右栏流程与弹窗同源、委托单不另编 01–06", async () => {
  const studio = await readFile(STUDIO_PATH, "utf8");
  assert.match(studio, /guideSteps: getPlatformCopy\("zh-CN"\)\.create\.flowSteps\.map\(\(step\) => step\.title\)/);
  assert.match(studio, /guideSteps: getPlatformCopy\("en-US"\)\.create\.flowSteps\.map\(\(step\) => step\.title\)/);
  assert.match(studio, /第一次使用，顺着五步完成/);
  assert.match(studio, /Follow five clear steps/);
  assert.doesNotMatch(studio, /step="0\d"/, "委托单的六项属于五步流程的前两步，不再另编序号");
  assert.doesNotMatch(studio, /Image 2/);
  for (const step of getPlatformCopy("zh-CN").create.flowSteps) {
    assert.doesNotMatch(step.title + step.body, /Image 2/);
  }
});

test("弹层由 studio 首启挂载，支持 guide=open 重开，且保留可隐藏的五步引导", async () => {
  const studio = await readFile(STUDIO_PATH, "utf8");
  assert.match(studio, /FirstRunOnboardingDialog/);
  assert.match(studio, /ONBOARDING_STORAGE_KEY/);
  assert.match(studio, /forceOnboarding/);
  // 既有引导条契约保持（与 agent-first-onboarding.test.ts 双保险）
  assert.match(studio, /GUIDE_STORAGE_KEY/);
  assert.match(studio, /第一次使用，顺着五步完成/);
});

test("create 页透传 guide 参数；顶栏有重开入口", async () => {
  const [page, shell] = await Promise.all([
    readFile(CREATE_PAGE_PATH, "utf8"),
    readFile(SHELL_PATH, "utf8"),
  ]);
  assert.match(page, /guide/);
  assert.match(page, /forceOnboarding/);
  assert.match(shell, /\/app\/create\?guide=open/);
  assert.match(shell, /data-testid="topbar-help"/);
});
