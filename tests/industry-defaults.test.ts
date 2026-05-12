import assert from "node:assert/strict";
import test from "node:test";
import {
  getDefaultThemesForIndustry,
  getTopThemeKeysForIndustry,
} from "../src/lib/config/industry-defaults";
import { BLANKET_THEME_POOL } from "../src/lib/config/blanket-themes";

/**
 * industry → 主题映射软契约：
 *
 * - home_goods / home_decor 必须把「proof_closeup / before_after / problem_solution / emotional_moment」
 *   排在 ugc_review 之前（家居产品的真实命中规律）。
 * - 任意已知行业返回的列表必须**完全覆盖** BLANKET_THEME_POOL，避免遗漏。
 * - 未知行业 / null / undefined → 直接返回完整 BLANKET_THEME_POOL。
 */

test("home_goods top 4 themes 覆盖 proof_closeup / before_after / problem_solution / emotional_moment", () => {
  const top = getTopThemeKeysForIndustry("home_goods", 4);
  assert.equal(top.length, 4);
  /// 这四个必须都在 top 4，不限顺序（顺序由策略决定，可微调）
  const expected = new Set([
    "proof_closeup",
    "before_after",
    "problem_solution",
    "emotional_moment",
  ]);
  for (const key of expected) {
    assert.ok(top.includes(key), `top 4 应包含 ${key}, 实际: ${JSON.stringify(top)}`);
  }
});

test("home_decor 把 emotional_moment 排在前面（软装首屏靠氛围感）", () => {
  const themes = getDefaultThemesForIndustry("home_decor");
  /// emotional_moment 必须在 ugc_review 之前
  const emoIdx = themes.findIndex((t) => t.key === "emotional_moment");
  const ugcIdx = themes.findIndex((t) => t.key === "ugc_review");
  assert.ok(emoIdx >= 0 && ugcIdx >= 0);
  assert.ok(
    emoIdx < ugcIdx,
    `home_decor: emotional_moment(idx=${emoIdx}) 必须排在 ugc_review(idx=${ugcIdx}) 之前`,
  );
});

test("已知行业返回的列表必须完全覆盖 BLANKET_THEME_POOL 全部 key", () => {
  const industries = [
    "home_goods",
    "home_decor",
    "real_estate",
    "pet_business",
    "restaurant",
    "local_service",
  ];
  const poolKeys = BLANKET_THEME_POOL.map((t) => t.key).sort();
  for (const industry of industries) {
    const themes = getDefaultThemesForIndustry(industry);
    const themeKeys = themes.map((t) => t.key).sort();
    assert.deepEqual(
      themeKeys,
      poolKeys,
      `行业 ${industry} 的主题列表必须完全覆盖 BLANKET_THEME_POOL`,
    );
  }
});

test("未知行业 / null / undefined → 返回完整 BLANKET_THEME_POOL", () => {
  const cases: (string | null | undefined)[] = [
    null,
    undefined,
    "",
    "general",
    "unknown_industry",
  ];
  for (const c of cases) {
    const themes = getDefaultThemesForIndustry(c);
    assert.equal(themes.length, BLANKET_THEME_POOL.length);
  }
});

test("getTopThemeKeysForIndustry: count 上下界保护", () => {
  /// count <= 0 时至少返回 1 个，避免 prompt 拼接出空数组
  const zero = getTopThemeKeysForIndustry("home_goods", 0);
  assert.ok(zero.length >= 1);
  /// count > 池子大小时返回完整池子（不抛错）
  const overflow = getTopThemeKeysForIndustry("home_goods", 999);
  assert.equal(overflow.length, BLANKET_THEME_POOL.length);
});
