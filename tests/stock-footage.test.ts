import assert from "node:assert/strict";
import test from "node:test";
import {
  __test__,
  isStockFootageAvailable,
  MIN_CLIP_DURATION_SEC,
  redactSecrets,
  searchStockClips,
  StockFootageUnavailableError,
} from "../src/lib/providers/stock-footage";

/**
 * 图库素材适配器（借鉴 MoneyPrinterTurbo material.py 的坑与解法）。
 * 详见 docs/roadmap/2026-08-01-moneyprinterturbo-review.md。
 */

function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const result = run();
  if (result instanceof Promise) return result.finally(restore);
  restore();
  return result;
}

const pexelsResponse = {
  videos: [
    {
      id: 101,
      duration: 12,
      user: { name: "Jane Doe" },
      url: "https://www.pexels.com/video/101/",
      video_files: [
        { link: "https://cdn.pexels.com/101-hd.mp4", width: 1080, height: 1920, file_type: "video/mp4" },
        { link: "https://cdn.pexels.com/101-sd.mp4", width: 540, height: 960, file_type: "video/mp4" },
        /// 横屏档：竖屏搜索时必须被画幅筛选剔除
        { link: "https://cdn.pexels.com/101-wide.mp4", width: 1920, height: 1080, file_type: "video/mp4" },
      ],
    },
    /// 太短：低于剪辑价值下限，整条剔除
    { id: 102, duration: 2, video_files: [{ link: "https://cdn.pexels.com/102.mp4", width: 1080, height: 1920, file_type: "video/mp4" }] },
  ],
};

test("无 key 时诚实不可用，绝不返回假素材", async () => {
  await withEnv({ PEXELS_API_KEYS: undefined, PIXABAY_API_KEYS: undefined }, async () => {
    assert.equal(isStockFootageAvailable(), false);
    await assert.rejects(
      searchStockClips({ term: "window blinds", aspect: "portrait" }),
      StockFootageUnavailableError,
    );
  });
});

test("Pexels：画幅筛选 + 时长下限 + 选最高分辨率档 + 保留来源记录", async () => {
  await withEnv({ PEXELS_API_KEYS: "pk-test", PIXABAY_API_KEYS: undefined }, async () => {
    const clips = await searchStockClips({
      term: "measuring window",
      aspect: "portrait",
      fetchImpl: (async () =>
        new Response(JSON.stringify(pexelsResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    assert.equal(clips.length, 1, "短素材与不匹配画幅的档位都该被剔除");
    const clip = clips[0];
    assert.equal(clip.id, "pexels:101");
    assert.equal(clip.downloadUrl, "https://cdn.pexels.com/101-hd.mp4", "该选竖屏里分辨率最高的档");
    assert.equal(clip.creator, "Jane Doe", "来源记录：被平台问素材哪来的要答得出");
    assert.ok(clip.durationSec >= MIN_CLIP_DURATION_SEC);
  });
});

test("Pexels 鉴权走 Authorization header，Pixabay 走 query（因此日志必须脱敏）", async () => {
  const seen: { url: string; auth: string | null }[] = [];
  await withEnv({ PEXELS_API_KEYS: "pk-secret", PIXABAY_API_KEYS: "pb-secret" }, async () => {
    await searchStockClips({
      term: "kitchen",
      aspect: "portrait",
      fetchImpl: (async (input: string | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen.push({ url: input.toString(), auth: headers.get("authorization") });
        return new Response(JSON.stringify({ videos: [], hits: [] }), { status: 200 });
      }) as typeof fetch,
    });
  });
  const pexels = seen.find((r) => r.url.includes("pexels.com"))!;
  const pixabay = seen.find((r) => r.url.includes("pixabay.com"))!;
  assert.equal(pexels.auth, "pk-secret");
  assert.ok(pixabay.url.includes("key=pb-secret"));
});

test("脱敏：错误信息里的 key 与 Authorization 都被抹掉", () => {
  const redacted = redactSecrets(
    'GET https://pixabay.com/api/videos/?key=pb-secret&q=a 失败; authorization: pk-secret',
  );
  assert.ok(!redacted.includes("pb-secret"));
  assert.ok(!redacted.includes("pk-secret"));
  assert.ok(redacted.includes("[REDACTED]"));
});

test("一个图库挂了不拖死另一个；两个都挂必须抛错而不是装作没搜到", async () => {
  await withEnv({ PEXELS_API_KEYS: "pk", PIXABAY_API_KEYS: "pb" }, async () => {
    /// pexels 500，pixabay 正常 → 仍返回 pixabay 的结果
    const clips = await searchStockClips({
      term: "sunset",
      aspect: "portrait",
      fetchImpl: (async (input: string | URL) => {
        if (input.toString().includes("pexels")) return new Response("boom", { status: 500 });
        return new Response(
          JSON.stringify({
            hits: [{
              id: 7, duration: 10, user: "u", pageURL: "https://pixabay.com/videos/7/",
              videos: { large: { url: "https://cdn.pixabay.com/7.mp4", width: 1080, height: 1920 } },
            }],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    assert.equal(clips.length, 1);

    /// 两个都挂 → 抛错。静默空数组会被上游当「没搜到」，真相是「服务出错」。
    await assert.rejects(
      searchStockClips({
        term: "sunset",
        aspect: "portrait",
        fetchImpl: (async () => new Response("boom", { status: 500 })) as typeof fetch,
      }),
      /图库搜索全部失败/,
    );
  });
});

test("多 key 轮换：计数器取模", () => {
  const keys = ["a", "b", "c"];
  assert.equal(__test__.nextKey(keys, 0), "a");
  assert.equal(__test__.nextKey(keys, 1), "b");
  assert.equal(__test__.nextKey(keys, 4), "b");
  assert.deepEqual(__test__.parseKeys(" a, b ,,c "), ["a", "b", "c"]);
  assert.deepEqual(__test__.parseKeys(undefined), []);
});

test("画幅判定：竖屏要求 h>w，横屏接受方形", () => {
  assert.equal(__test__.matchesAspect(1080, 1920, "portrait"), true);
  assert.equal(__test__.matchesAspect(1920, 1080, "portrait"), false);
  assert.equal(__test__.matchesAspect(1080, 1080, "landscape"), true);
});
