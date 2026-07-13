import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { access, readFile } from "node:fs/promises";
import { db } from "../src/lib/db";
import {
  isDigitalHumanFeatureEnabled,
  runDigitalHumanTrigger,
} from "../src/lib/features/digital-human";
import {
  claimDigitalHumanAdJob,
  completeDigitalHumanAdJob,
  createDigitalHumanAdJob,
} from "../src/lib/services/digital-human-service";
import { runDigitalHumanAdPipeline } from "../src/lib/video-generation/digital-human/store-ad-pipeline";

function patch(
  t: TestContext,
  target: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

test("digital human：feature flag 不受环境或 plan 影响，始终关闭", async (t) => {
  const previous = process.env.ENABLE_DIGITAL_HUMAN_AD;
  t.after(() => {
    if (previous === undefined) delete process.env.ENABLE_DIGITAL_HUMAN_AD;
    else process.env.ENABLE_DIGITAL_HUMAN_AD = previous;
  });
  process.env.ENABLE_DIGITAL_HUMAN_AD = "true";
  assert.equal(isDigitalHumanFeatureEnabled(), false);
  let triggerCalls = 0;
  const result = await runDigitalHumanTrigger(async () => {
    triggerCalls += 1;
    return "unexpected";
  });
  assert.deepEqual(result, { executed: false });
  assert.equal(triggerCalls, 0);
});

test("digital human：service create/claim/complete 在任何 DB 状态改变前 fail-closed", async (t) => {
  let dbCalls = 0;
  const model = db.digitalHumanAdJob as unknown as Record<string, unknown>;
  patch(t, model, {
    create: async () => { dbCalls += 1; },
    findMany: async () => { dbCalls += 1; return []; },
    findUnique: async () => { dbCalls += 1; return null; },
  });

  await assert.rejects(
    () => createDigitalHumanAdJob({
      adminUserId: "user",
      avatarAssetUri: "asset://sealed",
      voiceType: "sealed",
      storeImageUrls: ["https://example.com/store.jpg"],
      industry: "test",
      durationSec: 20,
    }),
    /DIGITAL_HUMAN_SEALED/,
  );
  await assert.rejects(() => claimDigitalHumanAdJob(), /DIGITAL_HUMAN_SEALED/);
  await assert.rejects(
    () => completeDigitalHumanAdJob({ jobId: "sealed" }),
    /DIGITAL_HUMAN_SEALED/,
  );
  assert.equal(dbCalls, 0);
});

test("digital human：pipeline 在 Seedance/TTS/ffmpeg 前 fail-closed", async () => {
  await assert.rejects(
    () => runDigitalHumanAdPipeline({
      jobId: "sealed",
      avatarAssetUri: "asset://sealed",
      voiceType: "sealed",
      storeImageUrls: ["https://example.com/store.jpg"],
      industry: "test",
      durationSec: 20,
    }),
    /DIGITAL_HUMAN_SEALED/,
  );
});

test("digital human：所有 HTTP 触发面先检查 sealed guard", async () => {
  const routes = [
    "src/app/api/digital-human/avatars/route.ts",
    "src/app/api/digital-human/voices/route.ts",
    "src/app/api/digital-human/jobs/route.ts",
    "src/app/api/digital-human/jobs/[id]/route.ts",
    "src/app/api/internal/digital-human/claim/route.ts",
    "src/app/api/internal/digital-human/complete/route.ts",
  ];
  for (const route of routes) {
    const source = await readFile(route, "utf8");
    assert.match(source, /isDigitalHumanFeatureEnabled/);
    const guardAt = source.indexOf("if (!isDigitalHumanFeatureEnabled())");
    const mutationAt = Math.min(
      ...["createDigitalHumanAdJob(", "claimDigitalHumanAdJob(", "completeDigitalHumanAdJob("]
        .map((token) => source.indexOf(token))
        .filter((index) => index >= 0),
    );
    assert.ok(guardAt >= 0, `${route} missing sealed guard`);
    if (Number.isFinite(mutationAt)) {
      assert.ok(guardAt < mutationAt, `${route} guard must precede mutation call`);
    }
  }
});

test("digital human：旧 provider、runner、workflow 与 demo 已归档，活动 package 无入口", async () => {
  const packageJson = await readFile("package.json", "utf8");
  assert.doesNotMatch(packageJson, /demo:omnihuman|digital-human:runner|demo:store-ad/);
  await access("deploy/china-future/code/volc-tts.ts");
  await access("deploy/china-future/code/omnihuman.ts");
  await access("deploy/china-future/workflows/digital-human-render.yml");
  const activeTts = await readFile("src/lib/providers/volc-tts.ts", "utf8");
  const activeOmni = await readFile("src/lib/providers/omnihuman.ts", "utf8");
  assert.doesNotMatch(activeTts, /fetch\s*\(/);
  assert.doesNotMatch(activeOmni, /fetch\s*\(/);
});
