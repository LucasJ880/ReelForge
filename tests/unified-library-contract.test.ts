import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { unifiedLibraryRowSchema } from "../src/lib/contracts/unified-library";
import { toUnifiedLibraryRow } from "../src/lib/services/unified-library-service";

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
    "briefId",
    "canRetry",
    "durationSec",
    "failedSceneCount",
    "id",
    "label",
    "progress",
    "status",
    "thumbnailUrl",
    "title",
    "updatedAt",
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
