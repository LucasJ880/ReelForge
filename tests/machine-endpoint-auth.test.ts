import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as processBatches } from "../src/app/api/cron/process-batches/route";
import { GET as pollVideos } from "../src/app/api/cron/poll-videos/route";
import { GET as stitchVideos } from "../src/app/api/cron/stitch-videos/route";
import { GET as stitchDispatch } from "../src/app/api/cron/stitch-dispatch/route";
import { GET as sweepStuckTasks } from "../src/app/api/cron/sweep-stuck-tasks/route";
import { GET as claimStitch } from "../src/app/api/internal/stitch/claim/route";
import { POST as completeStitch } from "../src/app/api/internal/stitch/complete/route";
import { GET as claimDigitalHuman } from "../src/app/api/internal/digital-human/claim/route";
import { POST as completeDigitalHuman } from "../src/app/api/internal/digital-human/complete/route";

type Handler = (request: NextRequest) => Promise<Response>;

const endpoints: Array<{ name: string; path: string; method: "GET" | "POST"; handler: Handler }> = [
  { name: "process batches", path: "/api/cron/process-batches", method: "GET", handler: processBatches },
  { name: "poll videos", path: "/api/cron/poll-videos", method: "GET", handler: pollVideos },
  { name: "stitch videos", path: "/api/cron/stitch-videos", method: "GET", handler: stitchVideos },
  { name: "stitch dispatch", path: "/api/cron/stitch-dispatch", method: "GET", handler: stitchDispatch },
  { name: "sweep stuck tasks", path: "/api/cron/sweep-stuck-tasks", method: "GET", handler: sweepStuckTasks },
  { name: "claim stitch", path: "/api/internal/stitch/claim", method: "GET", handler: claimStitch },
  { name: "complete stitch", path: "/api/internal/stitch/complete", method: "POST", handler: completeStitch },
  { name: "claim digital human", path: "/api/internal/digital-human/claim", method: "GET", handler: claimDigitalHuman },
  { name: "complete digital human", path: "/api/internal/digital-human/complete", method: "POST", handler: completeDigitalHuman },
];

function requestFor(
  endpoint: (typeof endpoints)[number],
  authorization?: string,
): NextRequest {
  return new NextRequest(`http://localhost${endpoint.path}`, {
    method: endpoint.method,
    headers: authorization ? { authorization } : undefined,
  });
}

test("machine endpoints: CRON_SECRET 缺失时全部 fail closed，且不泄漏配置名", async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    for (const endpoint of endpoints) {
      const response = await endpoint.handler(requestFor(endpoint));
      assert.equal(response.status, 503, `${endpoint.name} must fail closed`);
      const text = await response.text();
      assert.doesNotMatch(text, /CRON_SECRET|token|bearer/i);
    }
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("machine endpoints: 错误 bearer 全部返回 401", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "server-only-machine-secret";
  try {
    for (const endpoint of endpoints) {
      const response = await endpoint.handler(
        requestFor(endpoint, "Bearer wrong-secret"),
      );
      assert.equal(response.status, 401, `${endpoint.name} must reject bad auth`);
    }
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
