import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 2026-11-10 晚：把当天改过的地方在手机宽度和英文界面下实际走了一遍，修掉看到的几处小问题。
 */

test("老用户打开创作页，首屏就不渲染「第一次使用」提示条（原来先闪一下再消失）", () => {
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /const \[showGuide, setShowGuide\] = useState\(!returningUser\);/);
  assert.doesNotMatch(studio, /const \[showGuide, setShowGuide\] = useState\(true\);/);
  /// 挂载后仍按本地记号再核一遍（新用户自己关掉过的不再出现）
  assert.match(studio, /setShowGuide\(!returningUser && localStorage\.getItem\(GUIDE_STORAGE_KEY\) !== "dismissed"\);/);
});

test("弹窗与抽屉的关闭按钮：读屏文字跟界面语言走，不写死英文", () => {
  for (const file of ["src/components/ui/dialog.tsx", "src/components/ui/sheet.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<span className="sr-only">Close<\/span>/, file);
    assert.match(source, /<span className="sr-only">\{t\("common\.close"\)\}<\/span>/, file);
    assert.match(source, /import \{ useTranslation \} from "@\/i18n\/useTranslation"/, file);
  }
  const dialog = readFileSync("src/components/ui/dialog.tsx", "utf8");
  assert.doesNotMatch(dialog, /<Button variant="outline" \/>\}>\s+Close\s+</);
  const zh = readFileSync("src/i18n/dictionaries/zh-CN.ts", "utf8");
  const en = readFileSync("src/i18n/dictionaries/en-US.ts", "utf8");
  assert.match(zh, /close: "关闭",/);
  assert.match(en, /close: "Close",/);
});

test("商品编辑框里删图的小叉：手机上点得到（可点范围往外扩）", () => {
  const ui = readFileSync("src/components/products/product-library.tsx", "utf8");
  const button = ui.slice(ui.indexOf("aria-label={copy.removeImage}"), ui.indexOf('<X className="size-3.5"'));
  assert.match(button, /size-6/);
  assert.match(button, /before:absolute before:-inset-2 before:content-\[''\]/);
  assert.doesNotMatch(button, /\bsize-5\b/);
});
