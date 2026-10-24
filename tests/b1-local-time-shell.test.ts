import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatLocalTime } from "../src/components/exchange/local-time";
import { getPlatformCopy } from "../src/i18n/platform-copy";

/**
 * 1025 · B1.7 时间一律按访问者时区；B1.8 壳层几何、账户菜单、工作区芯片与套餐名。
 * 日期都用本地构造函数造，测试与运行环境的时区无关。
 */

const NOW = new Date(2026, 9, 24, 15, 30, 0);

test("datetime：今天只写时分，非今天带月日，非今年带年", () => {
  assert.equal(formatLocalTime(new Date(2026, 9, 24, 8, 51).toISOString(), "zh-CN", "datetime", NOW), "08:51");
  const yesterday = formatLocalTime(new Date(2026, 9, 23, 5, 51).toISOString(), "zh-CN", "datetime", NOW);
  assert.match(yesterday, /10月23日/);
  assert.match(yesterday, /05:51$/);
  assert.match(formatLocalTime(new Date(2025, 0, 2, 5, 0).toISOString(), "zh-CN", "datetime", NOW), /2025/);
  assert.match(formatLocalTime(new Date(2026, 9, 23, 5, 51).toISOString(), "en-US", "datetime", NOW), /Oct 23 05:51/);
});

test("date：今天写「今天」，非今天写月日；relative：刚刚 / N 分钟前 / 超过 7 天退回日期", () => {
  assert.equal(formatLocalTime(new Date(2026, 9, 24, 1, 0).toISOString(), "zh-CN", "date", NOW), "今天");
  assert.equal(formatLocalTime(new Date(2026, 9, 24, 1, 0).toISOString(), "en-US", "date", NOW), "Today");
  assert.equal(formatLocalTime(new Date(2026, 9, 20, 1, 0).toISOString(), "zh-CN", "date", NOW), "10月20日");
  assert.equal(formatLocalTime(new Date(2026, 9, 24, 15, 29, 40).toISOString(), "zh-CN", "relative", NOW), "刚刚");
  assert.equal(formatLocalTime(new Date(2026, 9, 24, 15, 25).toISOString(), "zh-CN", "relative", NOW), "5分钟前");
  assert.equal(formatLocalTime(new Date(2026, 9, 24, 12, 30).toISOString(), "en-US", "relative", NOW), "3 hours ago");
  assert.equal(formatLocalTime(new Date(2026, 9, 1, 12, 30).toISOString(), "zh-CN", "relative", NOW), "10月1日");
  assert.equal(formatLocalTime("garbage", "zh-CN", "date", NOW), "--");
});

test("服务端渲染的日期都走 LocalTime（服务端只传 ISO），生产带非今天带日期", () => {
  const files = [
    "src/app/(platform)/app/batches/page.tsx",
    "src/app/(platform)/app/library/page.tsx",
    "src/components/library/making-process-timeline.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /toLocaleDateString|toLocaleString\(|new Intl\.DateTimeFormat/, `${file} 不得在服务端格式化时间`);
    assert.match(source, /<LocalTime[\s\S]*?iso=\{[^}]*toISOString\(\)\}/, file);
  }
  const tape = readFileSync("src/components/exchange/exchange-tape.tsx", "utf8");
  assert.match(tape, /<LocalTime iso=\{item\.at\} locale=\{locale\} variant="datetime"/);
  const localTime = readFileSync("src/components/exchange/local-time.tsx", "utf8");
  assert.match(localTime, /useSyncExternalStore\(\s*subscribe,[\s\S]*?\(\) => null,\s*\)/, "服务端快照为占位，避免水合不一致");
});

test("壳层几何：顶栏高度与导轨 top 共用 --shell-top；导轨内部可滚；止住回弹", () => {
  const globals = readFileSync("src/app/globals.css", "utf8");
  assert.match(globals, /--shell-top: calc\(var\(--shell-bar\) \+ var\(--shell-tape\) \+ 1px\)/);
  assert.match(globals, /:root:has\(\.desk-theme\) \{\s*overscroll-behavior-y: none;/);
  const shell = readFileSync("src/components/platform/platform-shell.tsx", "utf8");
  assert.match(shell, /<header className="x-pane sticky top-0 z-30 h-\(--shell-top\) border-b">/);
  assert.match(shell, /<div className="flex h-\(--shell-bar\) items-center/);
  assert.match(shell, /className="h-\(--shell-tape\)"/);
  assert.match(shell, /<aside className="x-pane sticky top-\(--shell-top\)[^"]*h-\[calc\(100dvh-var\(--shell-top\)-var\(--shell-status\)\)\][^"]*overflow-y-auto/);
  assert.doesNotMatch(shell, /top-20|bottom-7|md:ml-56/);
});

test("头像打开账户菜单（邮箱、语言、隐私 / 条款、退出登录），不再一点就退出", () => {
  const shell = readFileSync("src/components/platform/platform-shell.tsx", "utf8");
  const menu = shell.slice(shell.indexOf("function AccountMenu"), shell.indexOf("export function PlatformShell"));
  assert.match(menu, /<DropdownMenuTrigger/);
  assert.match(menu, /\{email\}/);
  assert.match(menu, /LOCALES\.map/);
  assert.match(menu, /href="\/privacy"/);
  assert.match(menu, /href="\/terms"/);
  assert.match(menu, /data-testid="account-sign-out"[\s\S]*?onClick=\{\(\) => signOut\(\{ callbackUrl: "\/login" \}\)\}/);
  assert.equal((shell.match(/signOut\(\{/g) ?? []).length, 1, "退出只在账户菜单里");
});

test("工作区芯片不是假下拉；套餐名是入门版 / 专业版 / 试用版，不显示原始 id", () => {
  const shell = readFileSync("src/components/platform/platform-shell.tsx", "utf8");
  assert.doesNotMatch(shell, /ChevronsUpDown/);
  const chip = shell.slice(shell.indexOf('data-testid="workspace-chip"') - 200, shell.indexOf('data-testid="workspace-chip"') + 600);
  assert.doesNotMatch(chip, /<button/);
  assert.match(shell, /const planName = copy\.planNames\[pulse\.quota\.plan\]/);
  assert.doesNotMatch(shell, /\{planId\}|uppercase[^"]*">\{planName/);
  assert.deepEqual(getPlatformCopy("zh-CN").shell.planNames, { trial: "试用版", starter: "入门版", studio: "专业版" });
  assert.deepEqual(getPlatformCopy("en-US").shell.planNames, { trial: "Trial", starter: "Starter", studio: "Pro" });
});

test("市场状态：生成中看视频条数；没在生成但有排队写「排队中」；都没有才「空闲」", () => {
  const shell = readFileSync("src/components/platform/platform-shell.tsx", "utf8");
  assert.match(shell, /const live = pulse\.generating > 0;/);
  assert.match(shell, /const queued = !live && pulse\.queued > 0;/);
  assert.match(shell, /\{live \? copy\.marketLive : queued \? copy\.marketQueued : copy\.marketIdle\}/);
});
