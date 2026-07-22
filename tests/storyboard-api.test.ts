import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("storyboard APIs are owner-scoped and expose create, status, regenerate, and approval", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/app/api/video-generation/storyboards/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/video-generation/storyboards/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/video-generation/storyboards/[id]/approve/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/video-generation/storyboards/[id]/frames/[frameId]/regenerate/route.ts", import.meta.url), "utf8"),
  ]);
  const source = files.join("\n");
  assert.match(source, /createStoryboardRun/);
  assert.match(source, /reconcileStoryboardRun/);
  assert.match(source, /approveStoryboard/);
  assert.match(source, /regenerateStoryboardFrame/);
  assert.match(source, /session\.user\.id/);
});

test("the storyboard collection route exposes an owner-scoped resume entry point", async () => {
  const route = await readFile(
    new URL("../src/app/api/video-generation/storyboards/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /export async function GET/);
  assert.match(route, /findResumableStoryboardRunForUser\(guard\.session\.user\.id\)/);

  const service = await readFile(
    new URL("../src/lib/video-generation/storyboard-service.ts", import.meta.url),
    "utf8",
  );
  // Resume only surfaces runs that were never attached to a video and stays
  // inside a bounded window, so stale runs cannot hijack a fresh visit.
  assert.match(service, /videoBriefId: null/);
  assert.match(service, /videoJobId: null/);
  assert.match(service, /STORYBOARD_RESUME_WINDOW_MS/);
});

test("video dispatch requires an approved storyboard before provider submission", async () => {
  const route = await readFile(
    new URL("../src/app/api/video-generation/dispatch/route.ts", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../src/lib/services/video-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /storyboardRunId/);
  assert.match(route, /getApprovedStoryboardVideoReferences/);
  assert.match(route, /dispatchReservationKey: dispatchRequestId/);
  assert.match(service, /requireApprovedStoryboardForBrief/);
});
