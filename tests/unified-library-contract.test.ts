import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { unifiedLibraryRowSchema } from "../src/lib/contracts/unified-library";
import {
  deriveMakingProcess,
  filterCustomerLibraryRows,
  toUnifiedLibraryRow,
} from "../src/lib/services/unified-library-service";

type MapperInput = Parameters<typeof toUnifiedLibraryRow>[0];

function orderFixture(overrides: Record<string, unknown> = {}): MapperInput {
  return {
    id: "order-older-than-page-100",
    title: "Archived commercial asset",
    updatedAt: new Date("2026-07-14T12:00:00.000Z"),
    rounds: [
      {
        angles: [
          {
            videoBrief: {
              id: "brief-1",
              status: "READY",
              durationSec: 15,
              aspectRatio: "9:16",
              finalVideoUrl: null,
              finalThumbnailUrl: null,
              takedownAt: null,
              finalVideo: {
                status: "READY",
                stitchedVideoUrl: "https://assets.example.com/final.mp4",
                thumbnailUrl: "https://assets.example.com/thumb.jpg",
                segmentCount: 1,
              },
              videoJobs: [
                {
                  status: "SUCCEEDED",
                  lastProgress: 100,
                  submittedAt: new Date("2026-07-14T11:50:00.000Z"),
                },
              ],
            },
          },
        ],
      },
    ],
    ...overrides,
  } as unknown as MapperInput;
}

test("RF-029: list and detail share one runtime-validated SSR DTO mapper", () => {
  const row = toUnifiedLibraryRow(orderFixture());
  assert.ok(row);
  assert.deepEqual(unifiedLibraryRowSchema.parse(row), row);
  assert.deepEqual(Object.keys(row).sort(), [
    "aspectRatio",
    "batchId",
    /// 1025 · B1：CC BY 配乐署名随交付（单条读 FinalVideo.postProduction）。
    "bgmAttribution",
    "brandedVideoUrl",
    "briefId",
    /// P05-B：只重拼（换字幕样式 / 配乐）入口随行下发。
    "canRestitch",
    "canRetry",
    "durationSec",
    /// 2026-11-10：还在生成时已经等了几分钟（从 0 起），等待页写「已等 N 分钟」；其余为 null。
    "elapsedMinutes",
    "failedSceneCount",
    "id",
    /// PRD §4.3：素材库要收纳图文帖与轮播，因此多了 imageUrls 与 planId。
    "imageUrls",
    "isShowcase",
    "label",
    "planId",
    /// 1025 · B1：短视频帖是「待生产」，按形态分区。
    "postFormat",
    "progress",
    /// P05-C：段重做在途时不能再重做别的段、也不能只重拼。
    "redoInFlight",
    /// P05-C：成片各段与「重做这一段」入口。
    "segments",
    "source",
    "status",
    "thumbnailUrl",
    "title",
    "updatedAt",
    "videoJobId",
    "videoUrl",
    /// 2026-11-09：还在生成且等了很久时的已等待分钟数（详情页如实提示可取消重提）；其余为 null。
    "waitingMinutes",
  ]);
  assert.equal(row.waitingMinutes, null, "已完成的成片没有「等了多久」");
  assert.equal(row.elapsedMinutes, null, "已完成的成片没有「已等几分钟」");
  assert.equal(row.status, "ready");
  assert.equal(row.progress, 100);
  assert.equal(row.videoUrl, "https://assets.example.com/final.mp4");
});

test("RF-029: taken-down assets are excluded by the shared mapper", () => {
  const fixture = orderFixture();
  fixture.rounds[0]!.angles[0]!.videoBrief!.takedownAt = new Date();
  assert.equal(toUnifiedLibraryRow(fixture), null);
});

test("failed records without playable output are excluded from customer lists", () => {
  const ready = toUnifiedLibraryRow(orderFixture());
  assert.ok(ready);
  const failedWithoutVideo = {
    ...ready,
    id: "dead",
    status: "failed" as const,
    videoUrl: null,
  };
  const failedWithVideo = {
    ...failedWithoutVideo,
    id: "kept",
    videoUrl: "https://assets.example.com/recovered.mp4",
  };
  assert.deepEqual(
    filterCustomerLibraryRows([failedWithoutVideo, failedWithVideo, ready]).map(
      (row) => row.id,
    ),
    ["kept", ready.id],
  );
});

test("RF-029: detail query is direct and owner-scoped, never the take-100 list", async () => {
  const source = await readFile(
    "src/lib/services/unified-library-service.ts",
    "utf8",
  );
  const detail = source.slice(source.indexOf("export async function getUnifiedLibraryItem"));
  assert.match(detail, /deliveryOrder\.findFirst\(/);
  assert.match(detail, /id:\s*orderId/);
  assert.match(detail, /createdById:\s*userId/);
  assert.match(detail, /productCategory:\s*"unified_input"/);
  assert.doesNotMatch(detail, /loadUnifiedLibrary\(/);
  assert.doesNotMatch(detail, /take:\s*100/);
});

test("library detail derives making-process steps only from persisted evidence", () => {
  const steps = deriveMakingProcess({
    orderCreatedAt: new Date("2026-07-20T10:00:00.000Z"),
    briefCreatedAt: new Date("2026-07-20T10:01:00.000Z"),
    briefStatus: "RENDER_SUCCEEDED",
    storyboardStatus: "APPROVED",
    storyboardCreatedAt: new Date("2026-07-20T10:02:00.000Z"),
    storyboardApprovedAt: new Date("2026-07-20T10:04:00.000Z"),
    videoJobs: [
      {
        status: "SUCCEEDED",
        submittedAt: new Date("2026-07-20T10:05:00.000Z"),
        finishedAt: new Date("2026-07-20T10:10:00.000Z"),
      },
    ],
    finalVideoStatus: "READY",
    finalVideoFinishedAt: new Date("2026-07-20T10:11:00.000Z"),
    hasPlayableVideo: true,
  });
  assert.deepEqual(
    steps.map((step) => step.key),
    ["brief", "storyboard", "generation", "post-production"],
  );
  assert.ok(steps.every((step) => step.status === "completed"));
  assert.equal(steps[1]?.summary, "storyboard_approved");
});

test("制作过程：第 1 步的时间不晚于第 2 步（订单是点「生成视频」时才建的，比故事板晚）", () => {
  const steps = deriveMakingProcess({
    /// 真实顺序：建故事板 → 确认故事板 → 点生成视频（这时才有订单与 brief）
    orderCreatedAt: new Date("2026-11-10T02:11:00.000Z"),
    briefCreatedAt: new Date("2026-11-10T02:11:02.000Z"),
    briefStatus: "RENDER_SUCCEEDED",
    storyboardStatus: "APPROVED",
    storyboardCreatedAt: new Date("2026-11-10T02:04:00.000Z"),
    storyboardApprovedAt: new Date("2026-11-10T02:10:52.000Z"),
    videoJobs: [{ status: "SUCCEEDED", submittedAt: new Date("2026-11-10T02:11:02.000Z"), finishedAt: new Date("2026-11-10T02:57:41.000Z") }],
    finalVideoStatus: "READY",
    finalVideoFinishedAt: new Date("2026-11-10T02:59:00.000Z"),
    hasPlayableVideo: true,
  });
  assert.equal(steps[0]?.timestamp?.toISOString(), "2026-11-10T02:04:00.000Z", "需求确认 = 建故事板那一刻");
  assert.ok(steps[0]!.timestamp!.getTime() <= steps[1]!.timestamp!.getTime());
  /// 老数据（订单先于故事板、或没有故事板）照旧用 brief / 订单时间
  const legacy = deriveMakingProcess({
    orderCreatedAt: new Date("2026-07-20T10:00:00.000Z"),
    briefCreatedAt: new Date("2026-07-20T10:01:00.000Z"),
    briefStatus: "RENDER_SUCCEEDED",
    videoJobs: [],
    hasPlayableVideo: true,
  });
  assert.equal(legacy[0]?.timestamp?.toISOString(), "2026-07-20T10:01:00.000Z");
});
