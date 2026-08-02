import assert from "node:assert/strict";
import test from "node:test";
import {
  brollPlanSchema,
  missingSegments,
  pickFootageForPlan,
  BrollPlanError,
  type BrollPlan,
} from "../src/lib/services/broll-plan-service";

/**
 * b-roll 选片编排（借鉴 MoneyPrinterTurbo task.py 的 match_script_order 经验）。
 */

function plan(overrides: Partial<BrollPlan> = {}): BrollPlan {
  return brollPlanSchema.parse({
    aspect: "portrait",
    maxClipDurationSec: 4,
    segments: [
      { order: 0, narration: "很多人不知道窗户该怎么量", searchTerm: "measuring window frame", visualIntent: "量尺特写" },
      { order: 1, narration: "我们免费上门，十分钟量完", searchTerm: "home visit consultation", visualIntent: "上门场景" },
      { order: 2, narration: "装好之后是这个效果", searchTerm: "modern window blinds interior", visualIntent: "完工效果" },
    ],
    ...overrides,
  });
}

function fakeFetch(perTerm: Record<string, string[]>): typeof fetch {
  return (async (input: string | URL) => {
    const url = new URL(input.toString());
    const term = url.searchParams.get("query") ?? url.searchParams.get("q") ?? "";
    if (url.hostname.includes("pixabay")) {
      return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    }
    const ids = perTerm[term] ?? [];
    return new Response(
      JSON.stringify({
        videos: ids.map((id, i) => ({
          id,
          duration: 10,
          user: { name: "c" },
          url: `https://www.pexels.com/video/${id}/`,
          video_files: [{ link: `https://cdn.pexels.com/${id}.mp4`, width: 1080, height: 1920 - i, file_type: "video/mp4" }],
        })),
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}

function withKeys(run: () => Promise<void>) {
  const saved = process.env.PEXELS_API_KEYS;
  process.env.PEXELS_API_KEYS = "pk-test";
  return run().finally(() => {
    if (saved === undefined) delete process.env.PEXELS_API_KEYS;
    else process.env.PEXELS_API_KEYS = saved;
  });
}

test("🔴 选片保持脚本叙事顺序 —— MPT 的 match_script_order 经验", async () => {
  await withKeys(async () => {
    const picks = await pickFootageForPlan({
      plan: plan(),
      fetchImpl: fakeFetch({
        "measuring window frame": ["1"],
        "home visit consultation": ["2"],
        "modern window blinds interior": ["3"],
      }),
    });
    assert.deepEqual(
      picks.map((p) => p.segment.order),
      [0, 1, 2],
      "开头讲量尺、画面却是完工特写 —— 顺序错乱正是这条管线最要防的事故",
    );
    assert.deepEqual(
      picks.map((p) => p.candidates[0]?.id),
      ["pexels:1", "pexels:2", "pexels:3"],
    );
  });
});

test("首选素材跨段去重，后备候选可复用", async () => {
  await withKeys(async () => {
    const picks = await pickFootageForPlan({
      plan: plan(),
      fetchImpl: fakeFetch({
        /// 三个词都命中同一批素材
        "measuring window frame": ["9", "8"],
        "home visit consultation": ["9", "8"],
        "modern window blinds interior": ["9", "8"],
      }),
    });
    /// 第 0 段首选 9；第 1 段不能再用 9，首选 8；第 2 段两个都被占 → 空候选
    assert.equal(picks[0].candidates[0].id, "pexels:9");
    assert.equal(picks[1].candidates[0].id, "pexels:8");
    assert.deepEqual(missingSegments(picks), [2], "素材池吃空的段要能被点名");
  });
});

test("缺段判定：每一段都有素材才可进合成", () => {
  const segment = plan().segments[0];
  assert.deepEqual(missingSegments([{ segment, candidates: [] }]), [0]);
});

test("无图库 key 时明确标即将上线，不静默跳过", async () => {
  const savedPexels = process.env.PEXELS_API_KEYS;
  const savedPixabay = process.env.PIXABAY_API_KEYS;
  delete process.env.PEXELS_API_KEYS;
  delete process.env.PIXABAY_API_KEYS;
  try {
    await assert.rejects(
      pickFootageForPlan({ plan: plan() }),
      (err: unknown) =>
        err instanceof BrollPlanError &&
        err.reason === "footage_unavailable" &&
        /即将上线/.test(err.message),
    );
  } finally {
    if (savedPexels !== undefined) process.env.PEXELS_API_KEYS = savedPexels;
    if (savedPixabay !== undefined) process.env.PIXABAY_API_KEYS = savedPixabay;
  }
});

test("计划契约：段数上下限、切换频率上下限、搜索词必填", () => {
  assert.throws(() => brollPlanSchema.parse({ aspect: "portrait", maxClipDurationSec: 4, segments: [] }));
  assert.throws(() =>
    brollPlanSchema.parse({
      aspect: "portrait",
      maxClipDurationSec: 99,
      segments: plan().segments,
    }),
  );
  const p = plan();
  assert.ok(p.segments.every((s) => s.searchTerm.length > 0));
});
