import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  ContentPostRenderError,
  RENDER_LOCK_TTL_MS,
  mergeRenderedUrls,
  missingSlideIndexes,
  renderContentPost,
} from "../src/lib/services/content-post-render-service";

/**
 * A4 5.3（bughunt #15）图文出图：按 slide 补缺、渲染锁、只许「草稿 → READY」的 CAS。
 *
 * 用内存假表替换 db.contentPost 的 findFirst / updateMany（与 stitch-service-runtime
 * 同一套直接赋值 + t.after 恢复的写法），供应商用假 renderer，不碰真实库与真实出图。
 */

type PostRow = {
  id: string;
  userId: string;
  format: "SINGLE_IMAGE" | "CAROUSEL" | "TEXT";
  status: "DRAFT" | "READY" | "DISCARDED";
  imagePrompt: string | null;
  slidesJson: unknown;
  renderedImageUrls: string[];
  renderedAt: Date | null;
  renderError: string | null;
  renderStartedAt: Date | null;
};

type Where = Record<string, unknown>;

function matchesDate(value: Date | null, cond: unknown): boolean {
  if (cond === null) return value === null;
  if (cond instanceof Date) return value !== null && value.getTime() === cond.getTime();
  if (cond && typeof cond === "object" && "lt" in cond) {
    const lt = (cond as { lt: Date }).lt;
    return value !== null && value.getTime() < lt.getTime();
  }
  throw new Error(`unsupported date condition ${JSON.stringify(cond)}`);
}

function matches(row: PostRow, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "id" && row.id !== cond) return false;
    if (key === "status" && row.status !== cond) return false;
    if (key === "plan" && row.userId !== (cond as { userId: string }).userId) return false;
    if (key === "renderStartedAt" && !matchesDate(row.renderStartedAt, cond)) return false;
    if (key === "OR" && !(cond as Where[]).some((branch) => matches(row, branch))) return false;
  }
  return true;
}

function installFakePosts(t: TestContext, rows: PostRow[]) {
  const writes: Array<{ where: Where; data: Partial<PostRow> }> = [];
  const model = db.contentPost as unknown as Record<string, unknown>;
  const originals = { findFirst: model.findFirst, updateMany: model.updateMany };
  model.findFirst = async (args: { where: Where }) => {
    const row = rows.find((candidate) => matches(candidate, args.where));
    return row ? structuredClone(row) : null;
  };
  model.updateMany = async (args: { where: Where; data: Partial<PostRow> }) => {
    writes.push(args);
    let count = 0;
    for (const row of rows) {
      if (matches(row, args.where)) {
        Object.assign(row, args.data);
        count += 1;
      }
    }
    return { count };
  };
  t.after(() => {
    model.findFirst = originals.findFirst;
    model.updateMany = originals.updateMany;
  });
  return writes;
}

function carousel(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: "post-1",
    userId: "user-1",
    format: "CAROUSEL",
    status: "DRAFT",
    imagePrompt: null,
    slidesJson: [
      { order: 0, imagePrompt: "slide zero" },
      { order: 1, imagePrompt: "slide one" },
      { order: 2, imagePrompt: "slide two" },
    ],
    renderedImageUrls: [],
    renderedAt: null,
    renderError: null,
    renderStartedAt: null,
    ...overrides,
  };
}

function fakeRenderer(options: { failOnPrompt?: string; onCall?: () => void } = {}) {
  const prompts: string[] = [];
  return {
    prompts,
    ai: {
      isConfigured: () => true,
      generateImages: async (input: { prompt: string; storagePrefix?: string }) => {
        options.onCall?.();
        prompts.push(input.prompt.split("\n")[0]);
        if (options.failOnPrompt && input.prompt.startsWith(options.failOnPrompt)) {
          throw new Error("provider exploded");
        }
        return { urls: [`https://blob.example.test/${input.storagePrefix}img.png`] };
      },
    } as never,
  };
}

const FIXED_NOW = new Date("2026-10-25T12:00:00.000Z");

test("missingSlideIndexes / mergeRenderedUrls：按位置补缺，不留尾部空位", () => {
  assert.deepEqual(missingSlideIndexes(3, []), [0, 1, 2]);
  assert.deepEqual(missingSlideIndexes(3, ["a"]), [1, 2]);
  assert.deepEqual(missingSlideIndexes(3, ["a", "", "c"]), [1]);
  assert.deepEqual(missingSlideIndexes(2, ["a", "b", "extra"]), []);
  assert.deepEqual(
    mergeRenderedUrls(["a"], new Map([[1, "b"], [2, "c"]])),
    ["a", "b", "c"],
  );
  assert.deepEqual(mergeRenderedUrls(["a", "", "c"], new Map([[1, "b"]])), ["a", "b", "c"]);
  assert.deepEqual(mergeRenderedUrls([], new Map()), []);
});

test("🔴 半套轮播再点一次：只补缺的那几屏，补齐后才 READY", async (t) => {
  const row = carousel({ renderedImageUrls: ["https://blob.example.test/old-0.png"] });
  installFakePosts(t, [row]);
  const renderer = fakeRenderer();

  const result = await renderContentPost(
    { userId: "user-1", postId: "post-1" },
    { ai: renderer.ai, now: () => FIXED_NOW },
  );

  assert.equal(result.skipped, false);
  assert.deepEqual(renderer.prompts, ["slide one", "slide two"], "第 0 屏已有图，不能再出一遍");
  assert.equal(row.renderedImageUrls[0], "https://blob.example.test/old-0.png", "已出的图原样保留");
  assert.equal(row.renderedImageUrls.length, 3);
  assert.equal(row.status, "READY");
  assert.equal(row.renderStartedAt, null, "收尾必须释放渲染锁");
});

test("中途失败：已出的图按位置落库，状态仍是草稿，锁释放，下一次只补剩下的", async (t) => {
  const row = carousel();
  installFakePosts(t, [row]);
  const failing = fakeRenderer({ failOnPrompt: "slide one" });

  await assert.rejects(
    renderContentPost({ userId: "user-1", postId: "post-1" }, { ai: failing.ai, now: () => FIXED_NOW }),
    (err: unknown) => err instanceof ContentPostRenderError && err.reason === "provider",
  );
  assert.equal(row.status, "DRAFT", "有缺图就不能算完成");
  assert.equal(row.renderedImageUrls.length, 1, "第 0 屏花过钱，必须记下来");
  assert.equal(row.renderStartedAt, null);
  assert.match(row.renderError ?? "", /provider exploded/);

  const retry = fakeRenderer();
  await renderContentPost({ userId: "user-1", postId: "post-1" }, { ai: retry.ai, now: () => FIXED_NOW });
  assert.deepEqual(retry.prompts, ["slide one", "slide two"]);
  assert.equal(row.status, "READY");
  assert.equal(row.renderError, null);
});

test("🔴 渲染锁：另一个请求正在出图时直接 in_progress，不调供应商", async (t) => {
  const row = carousel({ renderStartedAt: new Date(FIXED_NOW.getTime() - 30_000) });
  installFakePosts(t, [row]);
  const renderer = fakeRenderer();

  await assert.rejects(
    renderContentPost({ userId: "user-1", postId: "post-1" }, { ai: renderer.ai, now: () => FIXED_NOW }),
    (err: unknown) => err instanceof ContentPostRenderError && err.reason === "in_progress",
  );
  assert.equal(renderer.prompts.length, 0, "抢不到锁就不能花钱");
});

test("过期的渲染锁（进程被杀）可以被接管", async (t) => {
  const row = carousel({
    renderStartedAt: new Date(FIXED_NOW.getTime() - RENDER_LOCK_TTL_MS - 1_000),
  });
  installFakePosts(t, [row]);
  const renderer = fakeRenderer();

  await renderContentPost({ userId: "user-1", postId: "post-1" }, { ai: renderer.ai, now: () => FIXED_NOW });
  assert.equal(renderer.prompts.length, 3);
  assert.equal(row.status, "READY");
});

test("🔴 出图期间被取消：不复活成 READY，但花过钱的图照样落库", async (t) => {
  const row = carousel();
  installFakePosts(t, [row]);
  const renderer = fakeRenderer({
    onCall: () => {
      /// 模拟商家在第一张图出来时点了「取消这一轮」（discardContentPost 的写法）
      row.status = "DISCARDED";
    },
  });

  await assert.rejects(
    renderContentPost({ userId: "user-1", postId: "post-1" }, { ai: renderer.ai, now: () => FIXED_NOW }),
    (err: unknown) => err instanceof ContentPostRenderError && err.reason === "discarded",
  );
  assert.equal(row.status, "DISCARDED", "CAS 只许草稿 → READY");
  assert.equal(renderer.prompts.length, 1, "取消之后不再出下一张，不再花钱");
  assert.deepEqual(
    row.renderedImageUrls,
    ["https://blob.example.test/content-posts/post-1/0-img.png"],
    "取消要保留已出的素材",
  );
  assert.equal(row.renderStartedAt, null);
});

test("已弃用的帖子不再出图；已出齐的帖子幂等返回、不调供应商", async (t) => {
  const discarded = carousel({ id: "post-d", status: "DISCARDED" });
  const done = carousel({
    id: "post-r",
    status: "READY",
    renderedImageUrls: ["a", "b", "c"],
  });
  installFakePosts(t, [discarded, done]);
  const renderer = fakeRenderer();

  await assert.rejects(
    renderContentPost({ userId: "user-1", postId: "post-d" }, { ai: renderer.ai }),
    (err: unknown) => err instanceof ContentPostRenderError && err.reason === "discarded",
  );
  const result = await renderContentPost({ userId: "user-1", postId: "post-r" }, { ai: renderer.ai });
  assert.deepEqual(result, { urls: ["a", "b", "c"], skipped: true });
  assert.equal(renderer.prompts.length, 0);
});

test("别人的帖子：读不到就是 not_found，不出图", async (t) => {
  installFakePosts(t, [carousel()]);
  const renderer = fakeRenderer();
  await assert.rejects(
    renderContentPost({ userId: "intruder", postId: "post-1" }, { ai: renderer.ai }),
    (err: unknown) => err instanceof ContentPostRenderError && err.reason === "not_found",
  );
  assert.equal(renderer.prompts.length, 0);
});

test("beforeRender（限流）只在拿到锁、确实要出图时调用；抛错会释放锁且不出图", async (t) => {
  const done = carousel({ id: "post-r", status: "READY", renderedImageUrls: ["a", "b", "c"] });
  const pending = carousel({ id: "post-p" });
  installFakePosts(t, [done, pending]);
  const renderer = fakeRenderer();
  let calls = 0;

  await renderContentPost(
    { userId: "user-1", postId: "post-r", beforeRender: async () => { calls += 1; } },
    { ai: renderer.ai },
  );
  assert.equal(calls, 0, "幂等短路不计限流次数");

  await assert.rejects(
    renderContentPost(
      {
        userId: "user-1",
        postId: "post-p",
        beforeRender: async () => {
          calls += 1;
          throw new Error("rate limited");
        },
      },
      { ai: renderer.ai, now: () => FIXED_NOW },
    ),
    /rate limited/,
  );
  assert.equal(calls, 1);
  assert.equal(renderer.prompts.length, 0);
  assert.equal(pending.renderStartedAt, null, "限流拒绝后锁必须释放，否则 10 分钟内都出不了图");
  assert.equal(pending.status, "DRAFT");
});
