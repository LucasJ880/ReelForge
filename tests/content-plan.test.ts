import assert from "node:assert/strict";
import test from "node:test";
import {
  contentPlanSchema,
  missingRequiredFormats,
  MIN_POSTS_PER_WEEK,
  REQUIRED_FORMATS,
} from "../src/lib/schemas/content-plan";
import {
  heuristicPlan,
  repairPlan,
  type ContentPlanInput,
} from "../src/lib/services/content-plan-service";

const input: ContentPlanInput = {
  sentence: "我家做定制百叶窗，想让人来约免费上门量尺",
  industry: "定制窗帘",
  brandName: "SunnyShutter",
};

test("启发式计划本身就满足验收：≥3 条且覆盖三种必需形态", () => {
  const plan = heuristicPlan(input);
  assert.ok(plan.posts.length >= MIN_POSTS_PER_WEEK);
  assert.deepEqual(missingRequiredFormats(plan), []);
});

test("一周内容摊开在多天，不堆在同一天", () => {
  const plan = heuristicPlan(input);
  const days = new Set(plan.posts.map((post) => post.dayOffset));
  assert.ok(days.size >= 3, "连续发布是目标，全堆在第 0 天等于没排期");
  for (const post of plan.posts) {
    assert.ok(post.dayOffset >= 0 && post.dayOffset <= 6);
  }
});

test("每条都带显式 hookType —— 这是 M0 留下的配方缺口的补法", () => {
  const plan = heuristicPlan(input);
  for (const post of plan.posts) {
    assert.ok(post.hookType, `${post.key} 缺 hookType`);
  }
  /// 不能全是同一个类型，否则赛马分不出结构差异。
  const types = new Set(plan.posts.map((post) => post.hookType));
  assert.ok(types.size >= 3, "钩子类型要有区分度");
});

test("模型少给形态时补齐，而不是把整份计划判死", () => {
  const plan = repairPlan(
    {
      theme: "本周主题",
      targetAudience: "本地客户",
      corePainPoint: "不知道怎么挑",
      posts: [
        {
          key: "a",
          dayOffset: 0,
          format: "text",
          hookType: "Pain",
          copy: { hook: "钩子", body: "正文", cta: null },
          hashtags: ["标签"],
          slides: [],
          rationale: "理由",
        },
      ],
    },
    input,
  );
  assert.deepEqual(missingRequiredFormats(plan), []);
  assert.ok(plan.posts.length >= MIN_POSTS_PER_WEEK);
  assert.equal(plan.theme, "本周主题", "模型给了的字段要保留，不能被兜底覆盖");
});

test("形态与视觉字段必须自洽：text 帖不许带 imagePrompt", () => {
  const plan = repairPlan(
    {
      posts: [
        {
          key: "a",
          format: "text",
          hookType: "Demo",
          copy: { hook: "钩子", body: "正文" },
          imagePrompt: "模型硬塞的出图提示词",
          slides: [{ order: 0, imagePrompt: "也硬塞了轮播" }],
        },
      ],
    },
    input,
  );
  const post = plan.posts.find((p) => p.key === "a");
  assert.equal(post?.imagePrompt, null);
  assert.deepEqual(post?.slides, []);
});

test("话题标签去掉 # 前缀，展示层再加", () => {
  const plan = repairPlan(
    {
      posts: [
        {
          key: "a",
          format: "text",
          hookType: "Demo",
          copy: { hook: "钩子", body: "正文" },
          hashtags: ["##本地商家", "#选购", "  ", 123],
        },
      ],
    },
    input,
  );
  const post = plan.posts.find((p) => p.key === "a");
  assert.deepEqual(post?.hashtags, ["本地商家", "选购"]);
});

test("hook 或 body 缺失的帖子丢弃，不用编出来的内容顶替", () => {
  const plan = repairPlan(
    { posts: [{ key: "broken", format: "text", copy: { hook: "只有钩子" } }] },
    input,
  );
  assert.ok(
    !plan.posts.some((post) => post.key === "broken"),
    "残缺帖子应被丢弃",
  );
  /// 丢完之后仍然要交付一份可用的计划。
  assert.ok(plan.posts.length >= MIN_POSTS_PER_WEEK);
});

test("非法 hookType / format 归位到安全值，不抛错", () => {
  const plan = repairPlan(
    {
      posts: [
        {
          key: "a",
          format: "reel",
          hookType: "Vibes",
          copy: { hook: "钩子", body: "正文" },
        },
      ],
    },
    input,
  );
  const post = plan.posts.find((p) => p.key === "a");
  assert.equal(post?.format, "text");
  assert.equal(post?.hookType, "Demo");
});

test("key 冲突时重新编号 —— 下游按 key 做幂等", () => {
  const plan = repairPlan(
    {
      posts: [
        { key: "same", format: "text", hookType: "Demo", copy: { hook: "a", body: "b" } },
        { key: "same", format: "text", hookType: "Pain", copy: { hook: "c", body: "d" } },
      ],
    },
    input,
  );
  const keys = plan.posts.map((post) => post.key);
  assert.equal(new Set(keys).size, keys.length, "key 必须唯一");
});

test("轮播分屏 3-6 屏，且分屏文字走 overlayText 不进 imagePrompt", () => {
  const plan = heuristicPlan(input);
  const carousel = plan.posts.find((post) => post.format === "carousel");
  assert.ok(carousel, "必须有轮播帖");
  assert.ok(carousel.slides.length >= 3 && carousel.slides.length <= 6);
  for (const slide of carousel.slides) {
    assert.ok(slide.overlayText, "分屏文字应由我们叠，不让模型画");
    assert.match(
      slide.imagePrompt,
      /no text/i,
      "出图提示词要明确禁止模型写字",
    );
  }
});

test("契约拒绝空计划与越界天数", () => {
  assert.throws(() =>
    contentPlanSchema.parse({
      theme: "t",
      targetAudience: "a",
      corePainPoint: "p",
      posts: [],
    }),
  );
  assert.throws(() =>
    contentPlanSchema.parse({
      theme: "t",
      targetAudience: "a",
      corePainPoint: "p",
      posts: [
        {
          key: "a",
          dayOffset: 9,
          format: "text",
          hookType: "Demo",
          copy: { hook: "h", body: "b", cta: null },
          hashtags: [],
          imagePrompt: null,
          slides: [],
          rationale: "r",
        },
      ],
    }),
  );
});

test("REQUIRED_FORMATS 覆盖本轮补的三个短板形态", () => {
  assert.deepEqual(REQUIRED_FORMATS, ["text", "single_image", "carousel"]);
});
