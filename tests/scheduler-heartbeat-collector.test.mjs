import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluateSchedulerHeartbeats,
  parseSchedulerHeartbeatLogs,
  SCHEDULER_HEARTBEAT_POLICY,
} from "../qa/certification/collect-scheduler-heartbeats.mjs";

const WINDOW_START = Date.parse("2026-07-14T00:00:00.000Z");
const WINDOW_END = "2026-07-14T01:00:00.000Z";

function heartbeat(scheduler, index, offsetSeconds, outcome = "ok") {
  const timestamp = new Date(WINDOW_START + offsetSeconds * 1000).toISOString();
  return {
    event: "scheduler_heartbeat",
    scheduler,
    phase: "finished",
    runId: `${scheduler}-${index}`,
    timestamp,
    startedAt: timestamp,
    durationMs: 10,
    outcome,
  };
}

function healthyEvents() {
  return SCHEDULER_HEARTBEAT_POLICY.requiredSchedulers.flatMap((scheduler) =>
    Array.from({ length: 60 }, (_, index) =>
      heartbeat(scheduler, index, 30 + index * 60),
    ),
  );
}

function reportFrom(events) {
  return evaluateSchedulerHeartbeats(
    {
      events: events.map((event) => ({
        scheduler: event.scheduler,
        runId: event.runId,
        timestamp: event.timestamp,
        timestampMs: Date.parse(event.timestamp),
        outcome: event.outcome,
      })),
      diagnostics: {
        parsedRecords: events.length,
        unparsedRecords: 0,
        heartbeatCandidates: events.length,
        ignoredStartedEvents: 0,
        invalidFinishedEvents: [],
      },
    },
    { windowEnd: WINDOW_END },
  );
}

test("RF-005 collector parses raw NDJSON and evaluates all three finished heartbeat streams", () => {
  const events = healthyEvents();
  const started = {
    ...events[0],
    phase: "started",
    outcome: undefined,
  };
  const ndjson = [
    "plain unrelated platform log",
    JSON.stringify(started),
    ...events.map((event) => JSON.stringify(event)),
  ].join("\n");
  const parsed = parseSchedulerHeartbeatLogs(ndjson);
  const report = evaluateSchedulerHeartbeats(parsed, { windowEnd: WINDOW_END });

  assert.equal(parsed.events.length, 180);
  assert.equal(parsed.diagnostics.ignoredStartedEvents, 1);
  assert.equal(parsed.diagnostics.unparsedRecords, 1);
  assert.equal(report.pass, true);
  for (const scheduler of report.schedulers) {
    assert.equal(scheduler.sampleCount, 60);
    assert.equal(scheduler.coverageMinutes, 59);
    assert.equal(scheduler.p95GapSeconds, 60);
    assert.equal(scheduler.maxGapSeconds, 60);
    assert.equal(scheduler.outcomeCounts.error, 0);
    assert.equal(scheduler.outcomeCounts.degraded, 0);
  }
});

test("RF-005 collector unwraps Vercel-style JSON message envelopes", () => {
  const wrapped = JSON.stringify({
    data: healthyEvents().map((event, index) => ({
      id: `vercel-log-${index}`,
      timestamp: Date.parse(event.timestamp),
      level: "info",
      message: JSON.stringify(event),
    })),
  });
  const parsed = parseSchedulerHeartbeatLogs(wrapped);
  const report = evaluateSchedulerHeartbeats(parsed, { windowEnd: WINDOW_END });

  assert.equal(parsed.diagnostics.parsedRecords, 1);
  assert.equal(parsed.events.length, 180);
  assert.equal(report.pass, true);
});

test("RF-005 collector enforces sample and coverage floors independently", () => {
  const events = healthyEvents().filter(
    (event) =>
      event.scheduler !== "process-batches" || Number(event.runId.split("-").at(-1)) < 54,
  );
  const report = reportFrom(events);
  const processBatches = report.schedulers.find(
    (scheduler) => scheduler.scheduler === "process-batches",
  );

  assert.equal(report.pass, false);
  assert.equal(processBatches.checks.minimumSamples.pass, false);
  assert.equal(processBatches.checks.minimumSamples.actual, 54);
  assert.equal(processBatches.checks.minimumCoverageMinutes.pass, false);
  assert.equal(processBatches.checks.minimumCoverageMinutes.actual, 53);
});

test("RF-005 collector rejects p95 gaps, maximum gaps, and degraded outcomes", () => {
  const p95Intervals = [
    ...Array.from({ length: 5 }, () => 130),
    ...Array.from({ length: 50 }, () => 57.8),
  ];
  const p95Offsets = [30];
  for (const interval of p95Intervals) {
    p95Offsets.push(p95Offsets.at(-1) + interval);
  }
  const processEvents = p95Offsets.map((offset, index) =>
    heartbeat("process-batches", index, offset),
  );
  const pollEvents = Array.from({ length: 60 }, (_, index) =>
    heartbeat("poll-videos", index, 30 + index * 60),
  ).filter((_, index) => ![20, 21, 22].includes(index));
  const stitchEvents = Array.from({ length: 60 }, (_, index) =>
    heartbeat(
      "stitch-dispatch",
      index,
      30 + index * 60,
      index === 30 ? "degraded" : "ok",
    ),
  );
  const report = reportFrom([...processEvents, ...pollEvents, ...stitchEvents]);
  const byName = Object.fromEntries(
    report.schedulers.map((scheduler) => [scheduler.scheduler, scheduler]),
  );

  assert.equal(report.pass, false);
  assert.equal(byName["process-batches"].sampleCount, 56);
  assert.equal(byName["process-batches"].coverageMinutes, 59);
  assert.equal(byName["process-batches"].p95GapSeconds, 130);
  assert.equal(byName["process-batches"].maxGapSeconds, 130);
  assert.equal(
    byName["process-batches"].checks.maximumP95GapSeconds.pass,
    false,
  );
  assert.equal(byName["process-batches"].checks.maximumGapSeconds.pass, true);
  assert.equal(byName["poll-videos"].maxGapSeconds, 240);
  assert.equal(byName["poll-videos"].checks.maximumGapSeconds.pass, false);
  assert.equal(
    byName["stitch-dispatch"].checks.noErrorOrDegradedOutcomes.pass,
    false,
  );
  assert.equal(byName["stitch-dispatch"].forbiddenOutcomes.length, 1);
});

test("RF-005 collector CLI emits JSON and exits nonzero when certification fails", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rf-heartbeats-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const healthyPath = path.join(directory, "healthy.ndjson");
  const unhealthyPath = path.join(directory, "unhealthy.ndjson");
  const healthy = healthyEvents();
  const unhealthy = healthy.map((event) =>
    event.scheduler === "stitch-dispatch" && event.runId.endsWith("-30")
      ? { ...event, outcome: "error" }
      : event,
  );
  await Promise.all([
    writeFile(healthyPath, healthy.map((event) => JSON.stringify(event)).join("\n")),
    writeFile(
      unhealthyPath,
      unhealthy.map((event) => JSON.stringify(event)).join("\n"),
    ),
  ]);
  const cli = path.resolve(
    "qa/certification/collect-scheduler-heartbeats.mjs",
  );
  const healthyRun = spawnSync(
    process.execPath,
    [cli, "--input", healthyPath, "--window-end", WINDOW_END],
    { encoding: "utf8" },
  );
  const unhealthyRun = spawnSync(
    process.execPath,
    [cli, "--input", unhealthyPath, "--window-end", WINDOW_END],
    { encoding: "utf8" },
  );

  assert.equal(healthyRun.status, 0, healthyRun.stderr || healthyRun.stdout);
  assert.equal(JSON.parse(healthyRun.stdout).pass, true);
  assert.equal(unhealthyRun.status, 1, unhealthyRun.stderr || unhealthyRun.stdout);
  const failure = JSON.parse(unhealthyRun.stdout);
  assert.equal(failure.pass, false);
  assert.ok(
    failure.failures.includes(
      "stitch-dispatch:noErrorOrDegradedOutcomes",
    ),
  );
});
