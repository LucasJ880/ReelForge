import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(
  "src/components/platform/platform-shell.tsx",
  "utf8",
);

test("390px /app shell exposes the same locale switcher as desktop", () => {
  /// 1025 · B1.8：桌面的语言切换收进账户菜单（头像不再一点就退出）；移动端顶栏仍有独立切换。
  assert.equal(
    (shell.match(/<LanguageSwitcher/g) ?? []).length,
    1,
    "mobile header keeps its own language switcher",
  );
  const accountMenu = shell.slice(shell.indexOf("function AccountMenu"), shell.indexOf("export function PlatformShell"));
  assert.match(accountMenu, /LOCALES\.map\(\(code\) =>[\s\S]*?setLocale\(code\)/, "account menu must switch language on desktop and mobile");
  assert.match(
    shell,
    /className="shrink-0 md:hidden" data-mobile-language-switcher/,
  );
  assert.match(
    shell,
    /data-mobile-language-switcher>[\s\S]{0,240}variant="inline"/,
  );
});

