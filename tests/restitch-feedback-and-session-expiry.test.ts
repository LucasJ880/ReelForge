import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sessionExpiredLoginUrl } from "@/lib/exchange/pulse";
import { toUnifiedLibraryRow } from "@/lib/services/unified-library-service";

/**
 * 2026-11-10 线上反馈的两件事：
 * 1. 勾了片尾落款点重拼，页面一动不动、合成完也不换片 → 以为没生效（其实成片已经带落款了）。
 * 2. 登录失效（发版 / 闲置 / 满 7 天）后开着的页面点哪都卡在加载中，要手动刷新才被送去登录。
 */

function orderWith(finalVideo: Record<string, unknown>) {
  return {
    id: "order-1",
    title: "三支装丝绒唇釉：玫瑰、珊瑚、浆果三个颜色。",
    createdAt: new Date("2026-11-10T02:04:00.000Z"),
    updatedAt: new Date("2026-11-10T02:12:00.000Z"),
    rounds: [
      {
        angles: [
          {
            videoBrief: {
              id: "brief-1",
              status: "QA_PENDING",
              durationSec: 15,
              aspectRatio: "9:16",
              finalVideoUrl: null,
              finalThumbnailUrl: null,
              brandedVideoUrl: null,
              takedownAt: null,
              createdAt: new Date("2026-11-10T02:12:00.000Z"),
              storyboardRun: null,
              finalVideo: {
                status: "READY",
                stitchedVideoUrl: "https://blob.example.com/renders/final-videos/fv-1/new.mp4",
                thumbnailUrl: null,
                subtitleFileUrl: null,
                segmentCount: 1,
                startedAt: new Date("2026-11-10T05:00:34.000Z"),
                finishedAt: new Date("2026-11-10T05:00:56.000Z"),
                previousStitchedVideoUrl: null,
                postProduction: null,
                ...finalVideo,
              },
              videoJobs: [
                {
                  status: "SUCCEEDED",
                  lastProgress: 100,
                  submittedAt: new Date("2026-11-10T02:12:00.000Z"),
                  finishedAt: new Date("2026-11-10T03:02:41.000Z"),
                  createdAt: new Date("2026-11-10T02:12:00.000Z"),
                  outputVideoUrl: "https://provider.example.com/segment-1.mp4",
                  id: "job-1",
                  segmentIndex: 0,
                  segmentDurationSec: 15,
                  finalVideoId: "fv-1",
                  replacesJobId: null,
                  supersededAt: null,
                  userSafeError: null,
                },
              ],
            },
          },
        ],
      },
    ],
  } as unknown as Parameters<typeof toUnifiedLibraryRow>[0];
}

test("重新合成中：有上一版成片作回滚依据、成片还没回到 READY → restitchInFlight，旧成片照常可看", () => {
  const inFlight = toUnifiedLibraryRow(
    orderWith({ status: "STITCHING", previousStitchedVideoUrl: "https://blob.example.com/renders/final-videos/fv-1/old.mp4" }),
  );
  assert.ok(inFlight);
  assert.equal(inFlight.restitchInFlight, true);
  assert.ok(inFlight.videoUrl, "旧成片地址还在，页面照常放");
  const queued = toUnifiedLibraryRow(
    orderWith({ status: "PENDING", previousStitchedVideoUrl: "https://blob.example.com/renders/final-videos/fv-1/old.mp4" }),
  );
  assert.equal(queued?.restitchInFlight, true);
});

test("不是重新合成：合成完回到 READY、第一次合成（没有上一版）、样片 → 都不标", () => {
  const done = toUnifiedLibraryRow(
    orderWith({ status: "READY", previousStitchedVideoUrl: "https://blob.example.com/renders/final-videos/fv-1/old.mp4" }),
  );
  assert.equal(done?.restitchInFlight, false);
  const firstStitch = toUnifiedLibraryRow(orderWith({ status: "STITCHING", previousStitchedVideoUrl: null }));
  assert.equal(firstStitch?.restitchInFlight, false);
  const showcase = toUnifiedLibraryRow(
    orderWith({ status: "STITCHING", previousStitchedVideoUrl: "https://blob.example.com/renders/final-videos/fv-1/old.mp4" }),
    true,
  );
  assert.equal(showcase?.restitchInFlight, false);
});

test("详情页：重新合成期间提示并自动刷新；成片地址一换播放器就重新加载", async () => {
  const detail = await readFile("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(detail, /\{item\.restitchInFlight \? \(\s*<div className="mb-3 max-w-xs" data-testid="reassembling-notice">\s*<ProcessingRefresher intervalMs=\{6_000\} \/>/);
  assert.match(detail, /<video\s+key=\{item\.videoUrl\}/);
});

test("登录失效后去登录页：带上原来的页面，并说明是失效；外部地址不带", () => {
  assert.equal(sessionExpiredLoginUrl("/app/library"), "/login?from=%2Fapp%2Flibrary&reason=expired");
  assert.equal(
    sessionExpiredLoginUrl("/app/library/abc", "?highlight=1"),
    "/login?from=%2Fapp%2Flibrary%2Fabc%3Fhighlight%3D1&reason=expired",
  );
  assert.equal(sessionExpiredLoginUrl("//evil.example.com"), "/login?from=%2Fapp&reason=expired");
  assert.equal(sessionExpiredLoginUrl("https://evil.example.com"), "/login?from=%2Fapp&reason=expired");
});

test("壳层：脉搏接口回 401 就整页跳登录，只跳一次；入口层对失效会话的接口请求确实回 401", async () => {
  const hook = await readFile("src/components/exchange/use-pulse.ts", "utf8");
  assert.match(
    hook,
    /if \(response\.status === 401\) \{[\s\S]{0,420}if \(!leaving\.current\) \{\s*leaving\.current = true;\s*window\.location\.assign\(sessionExpiredLoginUrl\(window\.location\.pathname, window\.location\.search\)\);/,
  );
  const middleware = await readFile("src/middleware.ts", "utf8");
  assert.match(middleware, /if \(pathname\.startsWith\("\/api\/"\)\) \{[\s\S]{0,360}\{ status: 401 \}/);
  const login = await readFile("src/app/(auth)/login/page.tsx", "utf8");
  assert.match(login, /searchParams\.get\("reason"\) === "expired"/);
});
