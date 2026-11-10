import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getGrowthCopy } from "../src/i18n/growth-copy";

/**
 * 2026-11-10 界面收尾：
 *  - 三处浏览器原生确认框（归档询盘、停用追踪链接、退出故事板）换成站内 ConfirmDialog；
 *  - 桌面侧栏不再把「创作」页列三遍（按钮 + 分组标题 + 导航项）；
 *  - 工作区正文 13 → 14px。
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(name) ? [path] : [];
  });
}

test("门禁：src 里不再出现浏览器原生的 confirm / alert / prompt", () => {
  const offenders = sourceFiles("src").filter((path) =>
    /\bwindow\.(?:confirm|alert|prompt)\(|(?<![.\w])(?:confirm|alert)\(/u.test(readFileSync(path, "utf8")),
  );
  assert.deepEqual(offenders, [], "用 ConfirmDialog（src/components/ui/confirm-dialog.tsx）");
});

test("ConfirmDialog：确认与取消的字由调用方给，取消只是关掉，忙的时候关不掉", () => {
  const dialog = readFileSync("src/components/ui/confirm-dialog.tsx", "utf8");
  assert.match(dialog, /^"use client";/);
  assert.match(dialog, /<DialogClose render=\{<Button type="button" variant="outline" disabled=\{busy\} \/>\}>\{cancelLabel\}<\/DialogClose>/);
  assert.match(dialog, /variant=\{tone === "danger" \? "destructive" : "default"\}/);
  assert.match(dialog, /onOpenChange=\{\(next\) => \(busy \? undefined : onOpenChange\(next\)\)\}/);
  /// 组件自己不带任何「确定」「OK」这类默认字
  assert.doesNotMatch(dialog.replace(/\/\*\*[\s\S]*?\*\//u, ""), /确定|>OK<|Confirm</u);
});

test("询盘归档 / 追踪链接停用：标题带上是哪一条，正文说后果，按钮写动作", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const copy = getGrowthCopy(locale).leads;
    assert.match(copy.archiveTitle, /\{name\}/);
    assert.match(copy.linkArchiveTitle, /\{name\}/);
    for (const text of [copy.archiveBody, copy.linkArchiveBody, copy.confirmCancel]) assert.ok(text.length > 0);
  }
  const zh = getGrowthCopy("zh-CN").leads;
  assert.match(zh.archiveBody, /记录会保留/);
  assert.match(zh.linkArchiveBody, /打不开/);
  assert.match(zh.linkArchiveBody, /点击记录会保留/);

  const board = readFileSync("src/components/leads/leads-board.tsx", "utf8");
  assert.match(board, /title=\{fillGrowth\(copy\.archiveTitle, \{ name: archiving\?\.name \?\? "" \}\)\}/);
  assert.match(board, /confirmLabel=\{copy\.archive\}/);
  assert.match(board, /if \(archiving\) void patch\(archiving\.id, \{ archived: true \}\);/);

  const links = readFileSync("src/components/leads/tracked-links-panel.tsx", "utf8");
  assert.match(links, /tone="danger"\s+busy=\{disableBusy\}/);
  assert.match(links, /confirmLabel=\{copy\.linkArchive\}/);
  /// 点图标只是打开确认框，真正停用在确认之后
  assert.match(links, /onClick=\{\(\) => \{\s+setDisabling\(link\);\s+setDisableOpen\(true\);\s+\}\}/);
});

test("修改创作方向：有故事板先问，确认后才放弃这一轮；取消被拒时故事板还在", () => {
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /onEditPlan=\{requestEditStoryboardDirection\}/);
  const request = studio.slice(
    studio.indexOf("function requestEditStoryboardDirection()"),
    studio.indexOf("async function editStoryboardDirection()"),
  );
  assert.match(request, /if \(storyboard\) setEditConfirmOpen\(true\);\s+else void editStoryboardDirection\(\);/);
  assert.match(studio, /busy=\{cancellingRound\}/);
  assert.match(studio, /onConfirm=\{\(\) => void editStoryboardDirection\(\)\.finally\(\(\) => setEditConfirmOpen\(false\)\)\}/);
  const edit = studio.slice(
    studio.indexOf("async function editStoryboardDirection()"),
    studio.indexOf("async function handleGenerate()"),
  );
  assert.match(edit, /if \(!cancelled\) return;/);
  for (const key of ["editStoryboardTitle", "editStoryboardBody", "editStoryboardConfirm", "editStoryboardStay"]) {
    assert.equal((studio.match(new RegExp(`^  ${key}: "`, "gmu")) ?? []).length, 2, `${key} 中英各一份`);
  }
});

test("侧栏：创作页的入口只有顶部那颗「新建视频」，移动端 tab 条不变", () => {
  const shell = readFileSync("src/components/platform/platform-shell.tsx", "utf8");
  assert.match(shell, /group\.items\.filter\(\(id\) => id !== "create"\)\.map\(\(id\) => link\(id\)\)/);
  assert.match(shell, /group\.id === "make" \? null : <span/);
  assert.match(shell, /data-testid="sidebar-new-video"[\s\S]{0,200}aria-current=\{activePath\(pathname, "\/app\/create"\) \? "page" : undefined\}/);
  assert.match(shell, /aria-\[current=page\]:bg-active/);
  assert.match(shell, /PLATFORM_PRIMARY_NAV\.map\(\(item\) => link\(item\.id\)\)/, "移动端仍然列出全部入口");
});

test("工作区正文 14px，说明文字仍是 12px", () => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const desk = tokens.slice(tokens.indexOf(":root:has(.desk-theme),"));
  assert.match(desk, /--font-size-meta: 12px;/);
  assert.match(desk, /--font-size-body: 14px;/);
  assert.doesNotMatch(desk.slice(0, 800), /--font-size-body: 13px;/);
});
