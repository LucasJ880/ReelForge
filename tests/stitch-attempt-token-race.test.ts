import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { POST as completeStitch } from "../src/app/api/internal/stitch/complete/route";
import { db } from "../src/lib/db";
import {
  claimStitchTask,
  finishStitchTask,
  STALE_STITCH_ATTEMPT_CODE,
} from "../src/lib/services/stitch-service";

type MutableFinalVideo = {
  id: string;
  status: FinalVideoStatus;
  stitchAttempts: number;
  stitchAttemptToken: string | null;
  stitchedVideoUrl: string | null;
  ffmpegError: string | null;
  thumbnailUrl: string | null;
};

function patchFinalVideo(t: TestContext, state: MutableFinalVideo) {
  const model = db.finalVideo as unknown as Record<string, unknown>;
  const originals = {
    findMany: model.findMany,
    findUnique: model.findUnique,
    updateMany: model.updateMany,
  };

  model.findMany = async () => {
    if (state.status !== FinalVideoStatus.PENDING) return [];
    return [
      {
        ...state,
        segmentCount: 1,
        targetDurationSec: 15,
        brief: { aspectRatio: "9:16" },
        segments: [
          {
            segmentIndex: 0,
            status: VideoJobStatus.SUCCEEDED,
            outputVideoUrl: "https://cdn.example.test/segment.mp4",
            outputThumbUrl: null,
          },
        ],
      },
    ];
  };
  model.findUnique = async () => ({ ...state, brief: null });
  model.updateMany = async (args: {
    where: {
      id?: string;
      status?: FinalVideoStatus;
      stitchAttemptToken?: string | null;
    };
    data: Record<string, unknown>;
  }) => {
    const matches =
      (!args.where.id || args.where.id === state.id) &&
      (!args.where.status || args.where.status === state.status) &&
      (!("stitchAttemptToken" in args.where) ||
        args.where.stitchAttemptToken === state.stitchAttemptToken);
    if (!matches) return { count: 0 };

    for (const [key, value] of Object.entries(args.data)) {
      if (
        key === "stitchAttempts" &&
        typeof value === "object" &&
        value !== null &&
        "increment" in value
      ) {
        state.stitchAttempts += Number(
          (value as { increment: number }).increment,
        );
      } else if (key in state) {
        (state as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return { count: 1 };
  };

  t.after(() => {
    model.findMany = originals.findMany;
    model.findUnique = originals.findUnique;
    model.updateMany = originals.updateMany;
  });
}

test("RF-004：旧 runner 的成功/失败回调不能覆盖重新领取后的当前尝试", async (t) => {
  const state: MutableFinalVideo = {
    id: "fv_two_attempt_race",
    status: FinalVideoStatus.PENDING,
    stitchAttempts: 0,
    stitchAttemptToken: null,
    stitchedVideoUrl: null,
    ffmpegError: null,
    thumbnailUrl: null,
  };
  patchFinalVideo(t, state);

  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "race-test-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  });

  const attemptA = await claimStitchTask();
  assert.ok(attemptA?.attemptToken);
  assert.equal(state.status, FinalVideoStatus.STITCHING);

  // 模拟 sweeper 对 A 超时后的 CAS 重排；旧 runner A 仍可能稍后回调。
  state.status = FinalVideoStatus.PENDING;
  state.stitchAttempts += 1;
  state.stitchAttemptToken = null;

  const attemptB = await claimStitchTask();
  assert.ok(attemptB?.attemptToken);
  assert.notEqual(attemptB?.attemptToken, attemptA.attemptToken);
  assert.equal(state.status, FinalVideoStatus.STITCHING);
  const activeSnapshot = { ...state };

  // 旧 A 的成功回调必须成为明确的 HTTP 409，而不是把 B 改成 READY。
  const response = await completeStitch(
    new NextRequest("http://localhost/api/internal/stitch/complete", {
      method: "POST",
      headers: {
        authorization: "Bearer race-test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        finalVideoId: state.id,
        attemptToken: attemptA.attemptToken,
        stitchedVideoUrl: "https://cdn.example.test/stale-a.mp4",
      }),
    }),
  );
  assert.equal(response.status, 409);
  const conflictBody = (await response.json()) as {
    code?: string;
    result?: { conflict?: boolean };
  };
  assert.equal(conflictBody.code, STALE_STITCH_ATTEMPT_CODE);
  assert.equal(conflictBody.result?.conflict, true);
  assert.deepEqual(state, activeSnapshot, "旧成功回调不得改写 B 的任何字段");

  // 旧 A 的失败回调也必须被拒绝，不能把当前 B 误标 FAILED。
  const staleFailure = await finishStitchTask({
    finalVideoId: state.id,
    attemptToken: attemptA.attemptToken,
    error: "late runner A failure",
  });
  assert.equal(staleFailure.conflict, true);
  assert.equal(staleFailure.error, STALE_STITCH_ATTEMPT_CODE);
  assert.deepEqual(state, activeSnapshot, "旧失败回调不得改写 B 的任何字段");

  // 当前 B 的凭证仍可完成终态写入，证明保护没有锁死正常回调。
  const currentFailure = await finishStitchTask({
    finalVideoId: state.id,
    attemptToken: attemptB.attemptToken,
    error: "active runner B failed",
  });
  assert.equal(currentFailure.conflict, undefined);
  assert.equal(currentFailure.status, FinalVideoStatus.FAILED);
  assert.equal(state.status, FinalVideoStatus.FAILED);
  assert.equal(state.ffmpegError, "active runner B failed");
  assert.equal(state.stitchAttemptToken, null);
  assert.equal(state.stitchAttempts, 2);
});

test("RF-004 rollout：迁移前已领取的 null-token runner 可完成，但不能覆盖新领取", async (t) => {
  const state: MutableFinalVideo = {
    id: "fv_legacy_inflight",
    status: FinalVideoStatus.STITCHING,
    stitchAttempts: 0,
    stitchAttemptToken: null,
    stitchedVideoUrl: null,
    ffmpegError: null,
    thumbnailUrl: null,
  };
  patchFinalVideo(t, state);

  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "rollout-test-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  });

  const legacyResponse = await completeStitch(
    new NextRequest("http://localhost/api/internal/stitch/complete", {
      method: "POST",
      headers: {
        authorization: "Bearer rollout-test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        finalVideoId: state.id,
        error: "legacy in-flight runner failed before token rollout",
      }),
    }),
  );
  assert.equal(legacyResponse.status, 200);
  assert.equal(state.status, FinalVideoStatus.FAILED);
  assert.equal(state.stitchAttempts, 1);

  // A missing token is only compatible with the pre-migration null-token row.
  // Once a new runner owns the row, the exact same legacy callback is stale.
  state.status = FinalVideoStatus.STITCHING;
  state.stitchAttemptToken = "new-token-owned-attempt";
  state.ffmpegError = null;
  const activeSnapshot = { ...state };
  const staleLegacyResponse = await completeStitch(
    new NextRequest("http://localhost/api/internal/stitch/complete", {
      method: "POST",
      headers: {
        authorization: "Bearer rollout-test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        finalVideoId: state.id,
        error: "late legacy callback",
      }),
    }),
  );
  assert.equal(staleLegacyResponse.status, 409);
  assert.deepEqual(state, activeSnapshot);
});

test("RF-004 runner：回调传输失败会使 workflow 失败而不是静默成功", async () => {
  const runner = await readFile(
    path.join(process.cwd(), "scripts/stitch-runner.ts"),
    "utf8",
  );
  assert.match(runner, /if \(failed > 0\) process\.exitCode = 1/);
  assert.match(runner, /complete endpoint did not accept successful output/);
  assert.match(runner, /if \(res\.status === 409\)/);
});
