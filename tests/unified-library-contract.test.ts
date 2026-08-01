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
    "brandedVideoUrl",
    "briefId",
    "canRetry",
    "durationSec",
    "failedSceneCount",
    "id",
    /// PRD §4.3：素材库要收纳图文帖与轮播，因此多了 imageUrls 与 planId。
    "imageUrls",
    "isShowcase",
    "label",
    "planId",
    "progress",
    "source",
    "status",
    "thumbnailUrl",
    "title",
    "updatedAt",
    "videoJobId",
    "videoUrl",
  ]);
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
