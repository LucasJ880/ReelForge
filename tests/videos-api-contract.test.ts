import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  videosApiItemSchema,
  videosApiQuerySchema,
  videosApiResponseSchema,
  VIDEOS_API_MAX_LIMIT,
} from "../src/lib/contracts/videos-api";
import {
  creativeRecipeSnapshot,
  DEFAULT_BRAND_PLACEMENT,
  hookTypeFromPattern,
  templateRecipeKey,
} from "../src/lib/video-generation/creative-recipe";

const template = { slug: "cinematic", version: 3 };

function validItem() {
  return {
    id: "batch-abc",
    video_url: "https://cdn.example.com/v.mp4",
    title: "百叶窗 · 电影感 #1",
    cover_url: "https://cdn.example.com/c.jpg",
    duration: 15,
    topic: "百叶窗",
    language: null,
    completed_at: new Date("2026-07-31T00:00:00.000Z").toISOString(),
    recipe_id: "tpl:cinematic@3",
    hook_type: "Demo",
    template_id: "cinematic@3",
    aspect_ratio: "9:16",
    brand_placement: "corner_badge",
  };
}

test("青砚占位契约的字段一个都不能少", () => {
  const item = videosApiItemSchema.parse(validItem());
  for (const key of [
    "id",
    "video_url",
    "title",
    "cover_url",
    "duration",
    "topic",
    "language",
  ]) {
    assert.ok(key in item, `青砚 mapAivoraItem 依赖 ${key}`);
  }
});

test("PRD §9.4 的配方字段全部在契约里，且允许 null", () => {
  const recipeKeys = [
    "recipe_id",
    "hook_type",
    "template_id",
    "aspect_ratio",
    "brand_placement",
  ] as const;

  const item = videosApiItemSchema.parse(validItem());
  for (const key of recipeKeys) {
    assert.ok(key in item, `契约缺少配方字段 ${key}`);
  }

  /// 历史成片（加列之前）全为 null，接口必须能把它们照常吐出去，
  /// 而不是因为配方缺失就整条丢掉。
  const historical: Record<string, unknown> = { ...validItem() };
  for (const key of recipeKeys) historical[key] = null;
  assert.doesNotThrow(() => videosApiItemSchema.parse(historical));
});

test("枚举外的钩子类型与植入档位一律拒绝，不静默透传", () => {
  assert.throws(() =>
    videosApiItemSchema.parse({ ...validItem(), hook_type: "Vibes" }),
  );
  assert.throws(() =>
    videosApiItemSchema.parse({ ...validItem(), brand_placement: "watermark" }),
  );
});

test("limit 有上限，防止一次拉穿整库", () => {
  assert.equal(videosApiQuerySchema.parse({}).limit, 100);
  assert.equal(videosApiQuerySchema.parse({ limit: "50" }).limit, 50);
  assert.throws(() =>
    videosApiQuerySchema.parse({ limit: VIDEOS_API_MAX_LIMIT + 1 }),
  );
});

test("meta 让「拉到 0 条」可诊断", () => {
  const parsed = videosApiResponseSchema.parse({
    videos: [],
    meta: { count: 0, skipped_unbranded: 12, next_since: null },
  });
  assert.equal(parsed.meta.skipped_unbranded, 12);
});

test("配方快照：拿到什么写什么，拿不到保持 null", () => {
  const full = creativeRecipeSnapshot({
    template,
    hookType: "Demo",
    aspectRatio: "9:16",
    brandPlacement: DEFAULT_BRAND_PLACEMENT,
  });
  assert.equal(full.recipeId, "tpl:cinematic@3");
  assert.equal(full.templateId, "cinematic@3");
  assert.equal(full.hookType, "Demo");
  assert.equal(full.aspectRatio, "9:16");
  assert.equal(full.brandPlacement, "corner_badge");

  /// 空输入必须返回空对象：展开进 create 时不能写出一堆假默认值，
  /// 否则赛马会把「未知」当成一个真实的配方桶。
  assert.deepEqual(creativeRecipeSnapshot({}), {});
});

test("脏值不落库：非枚举的钩子/档位直接不写这一列", () => {
  const snapshot = creativeRecipeSnapshot({
    hookType: "随便写的",
    brandPlacement: "sticker",
    aspectRatio: "   ",
  });
  assert.deepEqual(snapshot, {});
});

test("模板改版即换配方身份 —— 这正是赛马要的分组粒度", () => {
  assert.equal(templateRecipeKey({ slug: "cinematic", version: 3 }), "cinematic@3");
  assert.notEqual(
    templateRecipeKey({ slug: "cinematic", version: 3 }),
    templateRecipeKey({ slug: "cinematic", version: 4 }),
  );
});

test("hookTypeFromPattern 只认枚举内的值", () => {
  assert.equal(hookTypeFromPattern({ hookType: "POV" }), "POV");
  assert.equal(hookTypeFromPattern({ hookType: "Unknown" }), undefined);
  assert.equal(hookTypeFromPattern(null), undefined);
  assert.equal(hookTypeFromPattern("POV"), undefined);
});

test("三处 VideoJob 创建点都要落配方快照", () => {
  /// providerUnitPriceUsd 当初就是「列加了、没有写入点」，全代码库统计不出成本。
  /// 这条测试守住配方列不重蹈覆辙。
  const root = process.cwd();
  const batch = readFileSync(
    path.join(root, "src/lib/services/batch-service.ts"),
    "utf8",
  );
  const video = readFileSync(
    path.join(root, "src/lib/services/video-service.ts"),
    "utf8",
  );

  assert.match(batch, /creativeRecipeSnapshot\(/);
  const briefWrites = video.match(/briefCreativeRecipe\(/g) ?? [];
  assert.equal(
    briefWrites.length,
    3,
    "video-service 的单段与多段两个 create 都要落配方（含函数定义共 3 处）",
  );
});

test("/api/videos 必须机器鉴权，且没有会话回退", () => {
  const route = readFileSync(
    path.join(process.cwd(), "src/app/api/videos/route.ts"),
    "utf8",
  );
  assert.match(route, /machineAuthFailure\(req\)/);
  assert.match(route, /if \(machineFailure\) return machineFailure;/);
  /// 这是对外接口，不是 /api/internal/*：加会话回退等于多开一条暴露客户成片的路径。
  assert.doesNotMatch(route, /requireOperator|requireAdmin|getServerSession/);
});
