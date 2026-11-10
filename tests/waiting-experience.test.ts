import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import {
  SEGMENT_TYPICAL_MIN_DEFAULT,
  batchRunningProgress,
  deriveBusinessStatus,
  estimateIntraProgress,
  runningElapsedMinutes,
} from "@/lib/video-generation/business-status";
import { nextReadyAnnouncement } from "@/lib/exchange/ready-announcement";

/**
 * 等待体验（2026-11-10）：出片中位约 10 分钟、十条里一条要四十多分钟。这一组守住：
 * 进度不到点僵住、等待页说得出「已等多久 / 一般多久」、合成阶段与列表会自己更新、
 * 成片做好会提示、提交故事板那一分钟也能取消。
 */
const MIN = 60_000;

test("段内估算：起点 0、随时间一直在走、永远到不了封顶", () => {
  assert.equal(estimateIntraProgress(0), 0);
  const marks = [1, 3, 6, 10, 15, 20, 30, 45, 90].map((minutes) => estimateIntraProgress(minutes * MIN));
  for (let index = 1; index < marks.length; index += 1) {
    assert.ok(marks[index] > marks[index - 1], `第 ${index} 个刻度必须比前一个高`);
  }
  assert.ok(marks.at(-1)! < 0.95, "封顶值留给真实完成信号");
  /// 中位时长（10 分钟）走到约六成：不会一上来就冲到头，也不会过了中位还在两三成
  const atTypical = estimateIntraProgress(SEGMENT_TYPICAL_MIN_DEFAULT * MIN);
  assert.ok(atTypical > 0.55 && atTypical < 0.65, `中位时长应在六成左右，实际 ${atTypical}`);
});

test("单段视频：过了 6 分钟进度还在动（之前线性估算到 6 分钟就停在 77%）", () => {
  const running = {
    briefStatus: VideoBriefStatus.RENDERING,
    finalVideoStatus: FinalVideoStatus.PENDING,
    jobStatuses: [VideoJobStatus.RUNNING],
    segmentsSucceeded: 0,
    segmentsTotal: 1,
    runningProviderProgress: null,
  };
  const at = (minutes: number) => deriveBusinessStatus({ ...running, runningElapsedMs: minutes * MIN }).progressHint;
  assert.ok(at(12) > at(6));
  assert.ok(at(25) > at(12));
  assert.ok(at(45) > at(25));
  assert.ok(at(120) < 0.8, "估算永远低于段完成值");
});

test("已等待分钟数：从 0 起、向下取整；没在飞是 null", () => {
  assert.equal(runningElapsedMinutes(null), null);
  assert.equal(runningElapsedMinutes(undefined), null);
  assert.equal(runningElapsedMinutes(0), 0);
  assert.equal(runningElapsedMinutes(59_000), 0);
  assert.equal(runningElapsedMinutes(7 * MIN + 30_000), 7);
});

test("批量条目：合作方报了进度用真实值，没报按等待时长估算，不再恒 0%", () => {
  const now = new Date("2026-11-10T03:00:00Z");
  assert.equal(batchRunningProgress(42.4, new Date("2026-11-10T02:00:00Z"), now), 42);
  assert.equal(batchRunningProgress(null, null, now), 0);
  const justSubmitted = batchRunningProgress(null, now, now);
  assert.equal(justSubmitted, 20);
  const tenMinutes = batchRunningProgress(0, new Date(now.getTime() - 10 * MIN), now);
  const fortyMinutes = batchRunningProgress(null, new Date(now.getTime() - 40 * MIN), now);
  assert.ok(tenMinutes > 50 && tenMinutes < 60, `10 分钟应在五成多，实际 ${tenMinutes}`);
  assert.ok(fortyMinutes > tenMinutes && fortyMinutes < 80);
});

test("成片做好的提示：只提示比上次见到的新的；正看着这条的详情页就不弹", () => {
  const seen = "2026-11-10T02:00:00.000Z";
  assert.equal(nextReadyAnnouncement(null, seen, "/app/create"), null);
  assert.equal(nextReadyAnnouncement(undefined, seen, "/app/create"), null);
  const old = { id: "order-1", title: "旧的一条", at: "2026-11-10T01:59:00.000Z" };
  assert.equal(nextReadyAnnouncement(old, seen, "/app/create"), null);
  assert.equal(nextReadyAnnouncement({ ...old, at: seen }, seen, "/app/create"), null, "同一时刻不重弹");
  const fresh = {
    id: "order-2",
    title: "橄榄色蜡帆布卷口背包，黑色卡扣、皮质包边。拍一个人在山路上停下来，把卷口打开。",
    at: "2026-11-10T02:10:00.000Z",
  };
  const announcement = nextReadyAnnouncement(fresh, seen, "/app/create");
  assert.ok(announcement);
  assert.equal(announcement.href, "/app/library/order-2");
  assert.equal(announcement.at, fresh.at);
  assert.equal(announcement.silent, false);
  assert.ok(Array.from(announcement.title).length <= 19, "提示里的标题要短");
  assert.equal(nextReadyAnnouncement(fresh, seen, "/app/library/order-2")?.silent, true);
});

test("等待页与列表：合成阶段也自动刷新，列表有在途条目时自己更新", async () => {
  const detail = await readFile("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(detail, /item\.status === "generating" \|\| item\.status === "assembling" \? \(/);
  assert.match(detail, /copy\.waitingAssembling : copy\.waitingGenerating/);
  assert.match(detail, /data-testid="library-waiting-elapsed"/);
  const list = await readFile("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(list, /makingRows\.length > 0 \|\| waitingRows\.length > 0 \|\| pendingStoryboard\?\.status === "GENERATING" \? \(\s*<ProcessingRefresher intervalMs=\{20_000\} \/>/);
  assert.match(list, /data-testid="library-pending-storyboard"/);
});

test("壳层：脉搏带回最近做好的成片，有视频在途时标签页在后台也继续读", async () => {
  const readings = await readFile("src/lib/services/exchange-readings.ts", "utf8");
  assert.match(readings, /loadLatestReady\(userId, now\)/);
  assert.match(readings, /finalVideo: \{ status: "READY", finishedAt: \{ gte:/);
  const hook = await readFile("src/components/exchange/use-pulse.ts", "utf8");
  assert.match(hook, /document\.visibilityState !== "visible" && now > watchUntil\.current\) return;/);
  assert.match(hook, /if \(next\.generating > 0 \|\| next\.queued > 0\) watchUntil\.current = Date\.now\(\) \+ BACKGROUND_WATCH_GRACE_MS;/);
  const shell = await readFile("src/components/platform/platform-shell.tsx", "utf8");
  assert.match(shell, /useReadyAnnouncement\(\{ pulse, pathname, copy: copy\.readyAnnouncement/);
});

test("提交故事板那一分钟也能取消：点了记下来，提交一返回就让服务端真取消", async () => {
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /data-testid="cancel-storyboard-create"/);
  assert.match(studio, /busy === "storyboard" && !planningShots && !cancellingStoryboardCreate \?/);
  assert.match(
    studio,
    /if \(cancelStoryboardCreateRef\.current\) \{[\s\S]{0,200}if \(await cancelStoryboardOnServer\(payload\.run\)\) \{\s*markStoryboardRunDismissed\(payload\.run\.id\);\s*invalidatePlan\(\);/,
  );
});

test("出过成片的账号不再自动弹新手引导；指南里的重开入口照旧", async () => {
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /forceOnboarding\s*\|\| \(!returningUser && localStorage\.getItem\(ONBOARDING_STORAGE_KEY\) !== "dismissed"\)/);
  const page = await readFile("src/app/(platform)/app/create/page.tsx", "utf8");
  assert.match(page, /returningUser=\{finishedCount > 0\}/);
});

test("故事板出帧：写明一般多久，排队的帧不说「正在绘制」", async () => {
  const panel = await readFile("src/components/video-generation/storyboard-workflow-panel.tsx", "utf8");
  assert.match(panel, /一般三五分钟出齐/);
  assert.match(panel, /frame\?\.status === "QUEUED" && !regenerating/);
  assert.match(panel, /排队中，马上开始/);
});
