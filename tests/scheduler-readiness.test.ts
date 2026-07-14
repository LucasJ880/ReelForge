import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startSchedulerHeartbeat } from "../src/lib/scheduler-heartbeat";

const ROOT = process.cwd();

test("RF-005 config：Vercel Pro 每分钟覆盖 batch、poll+sweep、stitch dispatch", async () => {
  const raw = await readFile(path.join(ROOT, "vercel.json"), "utf8");
  const config = JSON.parse(raw) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(config.crons, [
    { path: "/api/cron/process-batches", schedule: "* * * * *" },
    { path: "/api/cron/poll-videos", schedule: "* * * * *" },
    { path: "/api/cron/stitch-dispatch", schedule: "* * * * *" },
  ]);

  const pollRoute = await readFile(
    path.join(ROOT, "src/app/api/cron/poll-videos/route.ts"),
    "utf8",
  );
  assert.match(pollRoute, /pollRunningJobs/);
  assert.match(pollRoute, /sweepStuckTasks/);
});

test("RF-005 config：GitHub 三个 workflow 仅保留手动入口，stitch 有并发去重组", async () => {
  for (const file of [
    "process-batches.yml",
    "poll-videos.yml",
    "stitch-videos.yml",
  ]) {
    const raw = await readFile(
      path.join(ROOT, ".github/workflows", file),
      "utf8",
    );
    assert.match(raw, /^\s*workflow_dispatch:\s*\{\}\s*$/m, file);
    assert.doesNotMatch(raw, /^\s*schedule:\s*$/m, file);
  }

  const stitch = await readFile(
    path.join(ROOT, ".github/workflows/stitch-videos.yml"),
    "utf8",
  );
  assert.match(stitch, /group:\s*stitch-videos/);
  assert.match(stitch, /cancel-in-progress:\s*false/);
});

test("RF-005 heartbeat：每次调度输出可检索的 start/finish，同一 run 只 finish 一次", () => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (message?: unknown) => logs.push(String(message));
  try {
    const dates = [
      new Date("2026-07-14T12:00:00.000Z"),
      new Date("2026-07-14T12:00:00.125Z"),
    ];
    const heartbeat = startSchedulerHeartbeat("poll-videos", {
      runId: "heartbeat-test",
      now: () => dates.shift() ?? new Date("2026-07-14T12:00:01.000Z"),
    });
    const first = heartbeat.finish("ok", { polled: 3, sweepCompleted: true });
    const second = heartbeat.finish("error", { polled: 0 });

    assert.equal(first, second, "重复 finish 不能制造重复 cadence 证据");
    assert.equal(logs.length, 2);
    const start = JSON.parse(logs[0]) as Record<string, unknown>;
    const finish = JSON.parse(logs[1]) as Record<string, unknown>;
    assert.equal(start.event, "scheduler_heartbeat");
    assert.equal(start.phase, "started");
    assert.equal(finish.phase, "finished");
    assert.equal(finish.runId, start.runId);
    assert.equal(finish.durationMs, 125);
    assert.equal(finish.outcome, "ok");
  } finally {
    console.log = originalLog;
  }
});
