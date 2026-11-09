/**
 * 广告法极限词检查（抖音发布包）：命中必须指出具体词与位置；序数 / 时间用法不误伤；
 * 命中即不可导出。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AD_LAW_TERMS,
  checkAdLawCopy,
  findAdLawTerms,
  splitByAdLawHits,
} from "../src/lib/compliance/ad-law-terms";

const terms = (text: string) => findAdLawTerms(text).map((hit) => hit.term);

test("[ad-law] 任务点名的六个词都在词表里并且能命中", () => {
  for (const term of ["最", "第一", "顶级", "国家级", "唯一", "100%"]) {
    assert.ok(AD_LAW_TERMS.includes(term), `${term} 不在词表`);
  }
  assert.deepEqual(terms("全网最低价"), ["最"]);
  assert.deepEqual(terms("销量第一的保温杯"), ["第一"]);
  assert.deepEqual(terms("顶级面料"), ["顶级"]);
  assert.deepEqual(terms("国家级工艺"), ["国家级"]);
  assert.deepEqual(terms("唯一指定"), ["唯一"]);
  assert.deepEqual(terms("100%纯棉"), ["100%"]);
});

test("[ad-law] 命中返回原文里的写法与位置，可以直接 slice 出来", () => {
  const text = "这是最好的选择，100％有效";
  const hits = findAdLawTerms(text);
  assert.deepEqual(
    hits.map((hit) => [hit.term, hit.matched, text.slice(hit.start, hit.end), hit.category]),
    [
      ["最", "最", "最", "superlative"],
      ["100%", "100％", "100％", "absolute"],
    ],
  );
});

test("[ad-law] 时间 / 序数用法不算极限词", () => {
  assert.deepEqual(terms("最近入手的杯子，最后说下手感，最终留下了，最初没想买"), []);
  assert.deepEqual(terms("第一次用、第一步先开盖、第一眼就喜欢、第一天到货、第一时间试了"), []);
  assert.deepEqual(terms("续航 1100% 不存在，电量 2100%"), []);
  assert.deepEqual(terms("NO.12 号色，TOP10 清单"), []);
});

test("[ad-law] 变体写法也命中：NO.1 / No1 / TOP1 / 百分百 / 全角百分号", () => {
  assert.deepEqual(terms("NO.1"), ["NO.1"]);
  assert.deepEqual(terms("No1 推荐"), ["NO.1"]);
  assert.deepEqual(terms("top 1 好物"), ["TOP1"]);
  assert.deepEqual(terms("百分百好评"), ["百分百"]);
  assert.deepEqual(terms("100 ％"), ["100%"]);
});

test("[ad-law] 同一位置只报一次：长词先占位，不重复报里面的短词", () => {
  assert.deepEqual(terms("销量冠军"), ["销量冠军"]);
  assert.deepEqual(terms("独一无二"), ["独一无二"]);
  /// 两处「最」各报一次
  assert.equal(findAdLawTerms("最轻最薄").length, 2);
});

test("[ad-law] 整份文案检查：标题 / 正文 / 话题分别标出，命中即不可导出", () => {
  const clean = checkAdLawCopy({
    title: "通勤路上一直在用的保温杯",
    body: "早上灌的热水，下午还是温的。杯口不烫嘴，单手就能开。",
    hashtags: ["保温杯", "通勤好物", "办公室日常"],
  });
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.hits, []);

  const dirty = checkAdLawCopy({
    title: "全网最保温的杯子",
    body: "国家级工艺，100%不漏水。",
    hashtags: ["保温杯", "顶级好物", "办公室日常"],
  });
  assert.equal(dirty.ok, false);
  assert.deepEqual(dirty.terms, ["最", "国家级", "100%", "顶级"]);
  assert.deepEqual(
    dirty.hits.map((hit) => [hit.field, hit.term, hit.hashtagIndex ?? null]),
    [
      ["title", "最", null],
      ["body", "国家级", null],
      ["body", "100%", null],
      ["hashtag", "顶级", 1],
    ],
  );
});

test("[ad-law] 空值安全；标红切片拼回去等于原文", () => {
  assert.deepEqual(findAdLawTerms(null), []);
  assert.deepEqual(findAdLawTerms(""), []);
  assert.equal(checkAdLawCopy({}).ok, true);
  const text = "顶级面料，第一眼就爱上，绝对值得";
  const parts = splitByAdLawHits(text);
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(
    parts.filter((part) => part.hit).map((part) => part.text),
    ["顶级", "绝对"],
  );
  assert.deepEqual(splitByAdLawHits("没有问题的文案"), [{ text: "没有问题的文案", hit: null }]);
});

test("[ad-law] 连续调用结果一致（全局正则不残留 lastIndex）", () => {
  for (let i = 0; i < 3; i += 1) assert.deepEqual(terms("顶级 顶级"), ["顶级", "顶级"]);
});
