import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { HOOK_ANGLES } from "@/lib/create/hook-angles";
import { guideArticle } from "@/lib/guide/guide-articles";

/**
 * 使用指南里提到的按钮名要和界面逐字一致（指南文件头的约定）。2026-11-10 把这两天加的功能写进了指南：
 * 换个开头、用同样的素材再做一条、成片评价、片尾落款。界面改名时这里会先红。
 */
for (const locale of ["zh-CN", "en-US"] as const) {
  test(`指南提到的按钮名与界面一致（${locale}）`, async () => {
    const copy = getPlatformCopy(locale).library;
    const flat = (slug: string) => JSON.stringify(guideArticle(slug, locale));

    const library = flat("library");
    assert.ok(library.includes(copy.restitchTitle), "重拼面板的标题");
    assert.ok(library.includes(copy.makeAnother), "再做一条的按钮");
    assert.ok(library.includes(copy.feedback.title), "评价面板的标题");
    for (const reason of ["product_mismatch", "unnatural_motion"] as const) {
      /// 指南里列的不满意原因用的是界面上的说法（中文逐字，英文允许小写开头）
      assert.ok(library.toLowerCase().includes(copy.feedback.reasons[reason].toLowerCase()), reason);
    }

    const brand = flat("brand");
    assert.ok(brand.includes(copy.restitchTitle));
    assert.ok(brand.includes(copy.signoff.title), "片尾落款的开关名");

    const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
    const hookLabel = locale === "zh-CN" ? "换个开头" : "Change the opening";
    assert.ok(studio.includes(`hookAngles: "${hookLabel}"`));
    const quickStart = flat("quick-start");
    assert.ok(quickStart.includes(hookLabel));
    if (locale === "zh-CN") {
      for (const angle of HOOK_ANGLES) assert.ok(quickStart.includes(angle.zh.label), angle.id);
      assert.ok(brand.includes(copy.restitchSubmit), "重拼按钮");
    }
  });
}

test("指南里的等待时间与界面上写的是同一个口径", () => {
  const quickStart = JSON.stringify(guideArticle("quick-start", "zh-CN"));
  const waiting = getPlatformCopy("zh-CN").library.waitingGenerating;
  assert.match(waiting, /一般 10–15 分钟出片，少数要半小时以上/);
  assert.match(quickStart, /一般 10–15 分钟出片，少数要半小时以上/);
  assert.match(quickStart, /一般两三分钟出齐/);
});
