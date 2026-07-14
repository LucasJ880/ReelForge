#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEDULER_HEARTBEAT_POLICY = Object.freeze({
  windowMinutes: 60,
  minimumSamples: 55,
  minimumCoverageMinutes: 55,
  maximumP95GapSeconds: 120,
  maximumGapSeconds: 180,
  requiredSchedulers: Object.freeze([
    "process-batches",
    "poll-videos",
    "stitch-dispatch",
  ]),
  forbiddenOutcomes: Object.freeze(["error", "degraded"]),
});

const VALID_OUTCOMES = new Set(["ok", "degraded", "skipped", "error"]);

function parseJsonCandidate(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.indexOf("{");
    const arrayStart = trimmed.indexOf("[");
    const starts = [objectStart, arrayStart].filter((value) => value >= 0);
    if (starts.length === 0) return null;
    const start = Math.min(...starts);
    const objectEnd = trimmed.lastIndexOf("}");
    const arrayEnd = trimmed.lastIndexOf("]");
    const end = Math.max(objectEnd, arrayEnd);
    if (end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function collectHeartbeatCandidates(value, candidates, depth = 0) {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") {
    const nested = parseJsonCandidate(value);
    if (nested !== null) {
      collectHeartbeatCandidates(nested, candidates, depth + 1);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectHeartbeatCandidates(item, candidates, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") return;

  if (value.event === "scheduler_heartbeat") {
    candidates.push(value);
    return;
  }
  for (const nested of Object.values(value)) {
    collectHeartbeatCandidates(nested, candidates, depth + 1);
  }
}

function validateFinishedHeartbeat(candidate) {
  if (candidate.phase !== "finished") return { ignored: true };
  const timestampMs = Date.parse(candidate.timestamp);
  const errors = [];
  if (typeof candidate.scheduler !== "string" || !candidate.scheduler.trim()) {
    errors.push("scheduler must be a non-empty string");
  }
  if (typeof candidate.runId !== "string" || !candidate.runId.trim()) {
    errors.push("runId must be a non-empty string");
  }
  if (!Number.isFinite(timestampMs)) {
    errors.push("timestamp must be an ISO-compatible timestamp");
  }
  if (!VALID_OUTCOMES.has(candidate.outcome)) {
    errors.push("outcome must be ok, skipped, degraded, or error");
  }
  if (errors.length > 0) {
    return {
      ignored: false,
      invalid: {
        scheduler:
          typeof candidate.scheduler === "string" ? candidate.scheduler : null,
        runId: typeof candidate.runId === "string" ? candidate.runId : null,
        errors,
      },
    };
  }
  return {
    ignored: false,
    event: {
      scheduler: candidate.scheduler,
      runId: candidate.runId,
      timestamp: new Date(timestampMs).toISOString(),
      timestampMs,
      outcome: candidate.outcome,
    },
  };
}

/**
 * Accepts raw heartbeat NDJSON, `vercel logs --json` output (one wrapper per
 * line), or a JSON document whose data/logs/messages contain wrapped entries.
 */
export function parseSchedulerHeartbeatLogs(text) {
  const candidates = [];
  let parsedRecords = 0;
  let unparsedRecords = 0;
  const wholeDocument = parseJsonCandidate(text);

  if (wholeDocument !== null) {
    parsedRecords = 1;
    collectHeartbeatCandidates(wholeDocument, candidates);
  } else {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = parseJsonCandidate(line);
      if (parsed === null) {
        unparsedRecords += 1;
        continue;
      }
      parsedRecords += 1;
      collectHeartbeatCandidates(parsed, candidates);
    }
  }

  const events = [];
  const invalidFinishedEvents = [];
  let ignoredStartedEvents = 0;
  for (const candidate of candidates) {
    const validated = validateFinishedHeartbeat(candidate);
    if (validated.ignored) {
      ignoredStartedEvents += 1;
    } else if (validated.invalid) {
      invalidFinishedEvents.push(validated.invalid);
    } else {
      events.push(validated.event);
    }
  }

  return {
    events,
    diagnostics: {
      parsedRecords,
      unparsedRecords,
      heartbeatCandidates: candidates.length,
      ignoredStartedEvents,
      invalidFinishedEvents,
    },
  };
}

function percentileNearestRank(values, percentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1];
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function evaluateOneScheduler({
  scheduler,
  events,
  windowStartMs,
  windowEndMs,
  policy,
}) {
  const inWindow = events
    .filter(
      (event) =>
        event.scheduler === scheduler &&
        event.timestampMs >= windowStartMs &&
        event.timestampMs <= windowEndMs,
    )
    .sort((left, right) => left.timestampMs - right.timestampMs);

  const byRunId = new Map();
  const duplicateLogEntries = [];
  const conflictingFinishedRuns = [];
  for (const event of inWindow) {
    const previous = byRunId.get(event.runId);
    if (!previous) {
      byRunId.set(event.runId, event);
      continue;
    }
    if (
      previous.timestampMs === event.timestampMs &&
      previous.outcome === event.outcome
    ) {
      duplicateLogEntries.push(event.runId);
    } else {
      conflictingFinishedRuns.push(event.runId);
    }
  }
  const unique = [...byRunId.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs,
  );
  const timestamps = unique.map((event) => event.timestampMs);
  const intervalGapsMs = timestamps.slice(1).map(
    (timestamp, index) => timestamp - timestamps[index],
  );
  const boundaryGapsMs =
    timestamps.length === 0
      ? [windowEndMs - windowStartMs]
      : [
          timestamps[0] - windowStartMs,
          windowEndMs - timestamps[timestamps.length - 1],
        ];
  const observedGapsSeconds = [...intervalGapsMs, ...boundaryGapsMs].map(
    (gap) => gap / 1000,
  );
  const coverageMinutes =
    timestamps.length < 2
      ? 0
      : (timestamps[timestamps.length - 1] - timestamps[0]) / 60_000;
  const p95GapSeconds = percentileNearestRank(observedGapsSeconds, 0.95);
  const maxGapSeconds = Math.max(...observedGapsSeconds);
  const forbidden = unique
    .filter((event) => policy.forbiddenOutcomes.includes(event.outcome))
    .map(({ runId, timestamp, outcome }) => ({ runId, timestamp, outcome }));

  const checks = {
    minimumSamples: {
      pass: unique.length >= policy.minimumSamples,
      actual: unique.length,
      required: policy.minimumSamples,
    },
    minimumCoverageMinutes: {
      pass: coverageMinutes >= policy.minimumCoverageMinutes,
      actual: round(coverageMinutes),
      required: policy.minimumCoverageMinutes,
    },
    maximumP95GapSeconds: {
      pass:
        p95GapSeconds !== null &&
        p95GapSeconds <= policy.maximumP95GapSeconds,
      actual: p95GapSeconds === null ? null : round(p95GapSeconds),
      required: policy.maximumP95GapSeconds,
    },
    maximumGapSeconds: {
      pass: maxGapSeconds <= policy.maximumGapSeconds,
      actual: round(maxGapSeconds),
      required: policy.maximumGapSeconds,
    },
    noErrorOrDegradedOutcomes: {
      pass: forbidden.length === 0,
      actual: forbidden.length,
      required: 0,
    },
    uniqueFinishedRun: {
      pass: conflictingFinishedRuns.length === 0,
      actual: conflictingFinishedRuns.length,
      required: 0,
    },
  };

  return {
    scheduler,
    pass: Object.values(checks).every((check) => check.pass),
    sampleCount: unique.length,
    coverageMinutes: round(coverageMinutes),
    firstFinishedAt: unique[0]?.timestamp ?? null,
    lastFinishedAt: unique.at(-1)?.timestamp ?? null,
    p95GapSeconds: p95GapSeconds === null ? null : round(p95GapSeconds),
    maxGapSeconds: round(maxGapSeconds),
    leadingGapSeconds: round(boundaryGapsMs[0] / 1000),
    trailingGapSeconds: round(boundaryGapsMs.at(-1) / 1000),
    outcomeCounts: Object.fromEntries(
      [...VALID_OUTCOMES].map((outcome) => [
        outcome,
        unique.filter((event) => event.outcome === outcome).length,
      ]),
    ),
    forbiddenOutcomes: forbidden,
    duplicateLogEntryCount: duplicateLogEntries.length,
    conflictingFinishedRunIds: [...new Set(conflictingFinishedRuns)],
    checks,
  };
}

export function evaluateSchedulerHeartbeats(
  parsed,
  {
    windowEnd = new Date(),
    policy = SCHEDULER_HEARTBEAT_POLICY,
  } = {},
) {
  const windowEndMs =
    windowEnd instanceof Date ? windowEnd.getTime() : Date.parse(windowEnd);
  if (!Number.isFinite(windowEndMs)) {
    throw new Error("windowEnd must be an ISO-compatible timestamp");
  }
  const windowStartMs = windowEndMs - policy.windowMinutes * 60_000;
  const schedulers = policy.requiredSchedulers.map((scheduler) =>
    evaluateOneScheduler({
      scheduler,
      events: parsed.events,
      windowStartMs,
      windowEndMs,
      policy,
    }),
  );
  const requiredSchedulerSet = new Set(policy.requiredSchedulers);
  const invalidRequiredEvents = parsed.diagnostics.invalidFinishedEvents.filter(
    (event) => event.scheduler === null || requiredSchedulerSet.has(event.scheduler),
  );
  const unexpectedSchedulers = [
    ...new Set(
      parsed.events
        .map((event) => event.scheduler)
        .filter((scheduler) => !requiredSchedulerSet.has(scheduler)),
    ),
  ].sort();
  const failures = schedulers.flatMap((scheduler) =>
    Object.entries(scheduler.checks)
      .filter(([, check]) => !check.pass)
      .map(([check]) => `${scheduler.scheduler}:${check}`),
  );
  if (invalidRequiredEvents.length > 0) {
    failures.push("input:invalid-finished-heartbeats");
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    pass: failures.length === 0,
    window: {
      start: new Date(windowStartMs).toISOString(),
      end: new Date(windowEndMs).toISOString(),
      durationMinutes: policy.windowMinutes,
    },
    policy,
    input: {
      ...parsed.diagnostics,
      invalidRequiredFinishedEvents: invalidRequiredEvents,
      unexpectedSchedulers,
    },
    schedulers,
    failures,
  };
}

function parseArguments(argv) {
  let input = "-";
  let windowEnd;
  let pretty = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--input") {
      input = argv[++index];
      if (!input) throw new Error("--input requires a path or -");
    } else if (argument === "--window-end") {
      windowEnd = argv[++index];
      if (!windowEnd) throw new Error("--window-end requires an ISO timestamp");
    } else if (argument === "--pretty") {
      pretty = true;
    } else if (argument === "--help" || argument === "-h") {
      return { help: true };
    } else if (!argument.startsWith("-") && input === "-") {
      input = argument;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { input, windowEnd, pretty, help: false };
}

async function readInput(input) {
  return input === "-" ? readFile(0, "utf8") : readFile(input, "utf8");
}

export async function runSchedulerHeartbeatCli(argv = process.argv.slice(2)) {
  try {
    const args = parseArguments(argv);
    if (args.help) {
      process.stdout.write(
        `${JSON.stringify({
          usage:
            "node qa/certification/collect-scheduler-heartbeats.mjs --input <logs.ndjson|-> [--window-end <ISO>] [--pretty]",
          note: "--window-end defaults to the current time; pass the collection end when replaying archived logs.",
        })}\n`,
      );
      return 0;
    }
    const text = await readInput(args.input);
    const parsed = parseSchedulerHeartbeatLogs(text);
    const report = evaluateSchedulerHeartbeats(parsed, {
      windowEnd: args.windowEnd ?? new Date(),
    });
    process.stdout.write(`${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`);
    return report.pass ? 0 : 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        pass: false,
        fatal: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    return 2;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await runSchedulerHeartbeatCli();
}
