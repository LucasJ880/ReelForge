import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const DIALOG_PATH = "src/components/video-generation/first-run-onboarding-dialog.tsx";
const STUDIO_PATH = "src/components/video-generation/streamlined-video-studio.tsx";
const SHELL_PATH = "src/components/platform/platform-shell.tsx";
const CREATE_PAGE_PATH = "src/app/(platform)/app/create/page.tsx";

test("首启 3 步引导弹层组件存在且中英双语、可勾选保留提示", async () => {
  const dialog = await readFile(DIALOG_PATH, "utf8");
  assert.match(dialog, /data-testid="first-run-onboarding"/);
  assert.match(dialog, /3 步出第一条成片/);
  assert.match(dialog, /Three steps to your first video/);
  assert.match(dialog, /在页面保留简短的新手提示/);
  assert.match(dialog, /Keep short hints on the page/);
  assert.match(dialog, /跳过/);
  assert.match(dialog, /开始创作/);
});

test("弹层由 studio 首启挂载，支持 guide=open 重开，且不动既有四步引导", async () => {
  const studio = await readFile(STUDIO_PATH, "utf8");
  assert.match(studio, /FirstRunOnboardingDialog/);
  assert.match(studio, /ONBOARDING_STORAGE_KEY/);
  assert.match(studio, /forceOnboarding/);
  // 既有引导条契约保持（与 agent-first-onboarding.test.ts 双保险）
  assert.match(studio, /GUIDE_STORAGE_KEY/);
  assert.match(studio, /第一次使用，顺着四步完成/);
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
