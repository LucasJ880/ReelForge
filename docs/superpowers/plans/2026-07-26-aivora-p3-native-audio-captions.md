# Aivora P3 Native Audio and Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate editable native voiceover through Shuyu Seedance `generate_audio`, then add deterministic captions and optional licensed BGM in post-production.

**Architecture:** Extend the unified request with optional audio and caption settings that default off for historical requests. Inject the final editable script into the Seedance prompt and pass `generate_audio` through Shuyu. Persist a post-production snapshot on `FinalVideo`; both local and external stitch paths use the same pure caption-timing and FFmpeg-plan module. Caption timing is deterministic from the final script and probed media duration because Shuyu returns no word timestamps.

**Tech Stack:** TypeScript, Zod, Shuyu Seedance API, Prisma 6, FFmpeg/ffprobe, ASS/SRT subtitles, Vercel Blob, React 19, Node test runner with TSX.

## Global Constraints

- Do not call the sealed legacy Volc TTS path.
- Native speech is produced only by Shuyu Seedance with `generate_audio: true`.
- The user-visible script is generated automatically but remains editable before submission.
- The model never burns text into video; captions are post-production overlays.
- BGM is optional, uses tracked licensed assets only, ducks beneath speech, and is capped at 0.35.
- Existing requests parse with audio and captions disabled.
- Prompt length remains below 5,000 characters.

---

### Task 1: Add backward-compatible audio and caption request contracts

**Files:**
- Modify: `src/types/video-generation.ts`
- Modify: `src/lib/schemas/unified-input.ts`
- Modify: `src/lib/video-generation/generation-supervisor.ts`
- Modify: `tests/customer-generation-contract.test.ts`
- Create: `tests/unified-audio-contract.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
test("historical requests default audio and captions off", () => {
  const parsed = unifiedVideoGenerationRequestSchema.parse(legacyFixture);
  assert.equal(parsed.audio?.voiceover?.enabled ?? false, false);
  assert.equal(parsed.captions?.enabled ?? false, false);
});

test("voiceover script is bounded and editable", () => {
  const parsed = unifiedVideoGenerationRequestSchema.parse({
    ...legacyFixture,
    audio: { voiceover: { enabled: true, voiceId: "warm-confident", language: "zh-CN", script: "现在开始。" } },
  });
  assert.equal(parsed.audio?.voiceover?.script, "现在开始。");
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/unified-audio-contract.test.ts tests/customer-generation-contract.test.ts`

Expected: FAIL because the request has no typed audio or caption fields.

- [ ] **Step 3: Add optional contracts**

```ts
audio?: {
  voiceover?: { enabled: boolean; voiceId: string; language: string; script: string };
  bgm?: { trackId: string; volume: number };
};
captions?: {
  enabled: boolean;
  style: "word_by_word" | "karaoke" | "plain";
  language: string;
  position: "top" | "center" | "bottom";
  exportSrt: boolean;
};
```

Bound script to 2,000 characters, volume to `0..0.35`, and known styles/positions. Carry the normalized snapshot through supervisor output without changing legacy classification.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/unified-audio-contract.test.ts tests/customer-generation-contract.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/video-generation.ts src/lib/schemas/unified-input.ts src/lib/video-generation/generation-supervisor.ts tests/customer-generation-contract.test.ts tests/unified-audio-contract.test.ts
git commit -m "feat: add unified audio and caption contracts"
```

### Task 2: Route native speech through Shuyu Seedance

**Files:**
- Modify: `src/lib/providers/shuyu.ts`
- Modify: `src/lib/video-generation/providers/shuyu-video-provider.ts`
- Modify: `src/lib/video-generation/prompt-intelligence.ts`
- Modify: `tests/shuyu-video-provider.test.ts`
- Modify: `tests/seedance-generate-audio.test.ts`
- Modify: `tests/digital-human-sealed.test.ts`

- [ ] **Step 1: Add failing Shuyu request tests**

```ts
test("Shuyu Seedance forwards native audio generation", async () => {
  await provider.createVideoJob({ ...fixture, generateAudio: true });
  assert.equal(submissionBody.generate_audio, true);
});

test("disabled voiceover forwards generate_audio false", async () => {
  await provider.createVideoJob({ ...fixture, generateAudio: false });
  assert.equal(submissionBody.generate_audio, false);
});
```

Also assert the provider prompt contains the exact final dialogue and still forbids on-screen captions.

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/shuyu-video-provider.test.ts tests/seedance-generate-audio.test.ts tests/digital-human-sealed.test.ts`

Expected: FAIL because Shuyu omits `generate_audio`.

- [ ] **Step 3: Implement Shuyu native speech**

Add `generateAudio?: boolean` to `ShuyuCreateVideoInput`, serialize it as `generate_audio`, and forward `options.generateAudio` from `ShuyuVideoProvider`. The dialogue prompt format is:

```text
Spoken dialogue (voice only, exact wording, <language>, <voice style>): "<escaped script>"
Do not render subtitles, captions, readable text, or a music bed.
```

Never import or call `src/lib/providers/volc-tts.ts`.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/shuyu-video-provider.test.ts tests/seedance-generate-audio.test.ts tests/digital-human-sealed.test.ts && npm run typecheck`

Expected: PASS and the sealed legacy TTS fetch count remains zero.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/shuyu.ts src/lib/video-generation/providers/shuyu-video-provider.ts src/lib/video-generation/prompt-intelligence.ts tests/shuyu-video-provider.test.ts tests/seedance-generate-audio.test.ts tests/digital-human-sealed.test.ts
git commit -m "feat: generate native speech through Shuyu Seedance"
```

### Task 3: Build deterministic subtitle timing and FFmpeg plans

**Files:**
- Create: `src/lib/video-generation/audio-post-production.ts`
- Create: `tests/audio-post-production.test.ts`

- [ ] **Step 1: Write failing pure-function tests**

```ts
test("allocates the full probed duration by readable token weight", () => {
  const cues = buildDeterministicCues("第一句。Second sentence!", 8);
  assert.equal(cues[0].startMs, 0);
  assert.equal(cues.at(-1)?.endMs, 8000);
  assert.ok(cues.every((cue) => cue.endMs > cue.startMs));
});

test("FFmpeg plan ducks licensed BGM under native speech", () => {
  const plan = buildAudioFilterPlan({ bgmVolume: 0.25, hasNativeAudio: true });
  assert.match(plan.filterComplex, /sidechaincompress/);
  assert.match(plan.filterComplex, /loudnorm=I=-16:TP=-1\.5/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/audio-post-production.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure planner**

Split on CJK/Latin punctuation, then into readable chunks; assign minimum cue durations and distribute the remainder by grapheme weight. Produce deterministic SRT and escaped ASS with safe-area positions. Define the catalog:

```ts
[
  { id: "none", label: "无配乐", path: null },
  { id: "wholesome", label: "Wholesome", path: "scripts/assets/pet-kit-bgm.mp3", license: "CC BY 4.0", author: "Kevin MacLeod" },
]
```

The FFmpeg plan loops/trims BGM, applies sidechain compression when native audio exists, mixes tracks, and normalizes final audio to `-16 LUFS` and `-1.5 dBTP`.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/audio-post-production.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/video-generation/audio-post-production.ts tests/audio-post-production.test.ts
git commit -m "feat: add deterministic caption and audio plans"
```

### Task 4: Persist and execute post-production in local and external stitchers

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260726123000_final_video_post_production/migration.sql`
- Modify: `src/lib/services/stitch-service.ts`
- Modify: `src/lib/video-generation/assembly-executor.ts`
- Modify: `src/app/api/internal/stitch/complete/route.ts`
- Modify: `scripts/stitch-runner.ts`
- Modify: `tests/stitch-dispatch-contract.test.ts`
- Modify: `tests/stitch-service-runtime.test.ts`
- Modify: `tests/stitch-runner-thumbnail.test.ts`
- Create: `tests/stitch-post-production.test.ts`

- [ ] **Step 1: Add failing runner-contract tests**

```ts
test("claimed stitch task contains the persisted post-production plan", async () => {
  assert.deepEqual(task.postProduction.captions, fixtureCaptions);
  assert.equal(task.postProduction.audio.bgm.trackId, "wholesome");
});

test("successful callback persists an optional SRT URL", async () => {
  assert.equal(completed.subtitleFileUrl, "https://blob.example/final.srt");
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/stitch-dispatch-contract.test.ts tests/stitch-service-runtime.test.ts tests/stitch-runner-thumbnail.test.ts tests/stitch-post-production.test.ts`

Expected: FAIL because `FinalVideo` and stitch contracts have no post-production data.

- [ ] **Step 3: Add persistence and shared execution**

Add nullable `postProduction Json?` and `subtitleFileUrl String?` to `FinalVideo`. Snapshot normalized settings before provider dispatch. Include the snapshot in `ClaimedStitchTask`. In the runner, probe actual duration, generate ASS/SRT, apply the shared filter plan, upload video/thumbnail and optional SRT, and send `subtitleFileUrl` to complete. Mirror the same behavior in local assembly. Missing captions/BGM must preserve the current concat command.

- [ ] **Step 4: Verify**

Run: `npx prisma generate && node --import tsx --test tests/stitch-dispatch-contract.test.ts tests/stitch-service-runtime.test.ts tests/stitch-runner-thumbnail.test.ts tests/stitch-post-production.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260726123000_final_video_post_production/migration.sql src/lib/services/stitch-service.ts src/lib/video-generation/assembly-executor.ts src/app/api/internal/stitch/complete/route.ts scripts/stitch-runner.ts tests/stitch-dispatch-contract.test.ts tests/stitch-service-runtime.test.ts tests/stitch-runner-thumbnail.test.ts tests/stitch-post-production.test.ts
git commit -m "feat: execute caption and BGM post-production"
```

### Task 5: Add automatic, editable voiceover controls

**Files:**
- Modify: `src/components/video-generation/streamlined-video-studio.tsx`
- Create: `src/components/video-generation/audio-caption-controls.tsx`
- Modify: `tests/template-recipe-ux.test.ts`
- Create: `tests/audio-caption-controls.test.ts`

- [ ] **Step 1: Add failing UI contracts**

```ts
test("voiceover starts with generated editable script", () => {
  assert.match(source, /生成口播稿/);
  assert.match(source, /<textarea/);
  assert.match(source, /generate_audio|voiceover/);
});

test("BGM disclosure includes license attribution", () => {
  assert.match(source, /CC BY 4\.0/);
  assert.match(source, /Kevin MacLeod/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/audio-caption-controls.test.ts tests/template-recipe-ux.test.ts`

Expected: FAIL because the controls do not exist.

- [ ] **Step 3: Implement controls**

Generate a concise script locally from the selected commerce recipe, product brief, CTA, duration, and language; place it in an editable textarea. Provide native voice toggle, voice-style choices, caption style/position/SRT toggle, BGM choice, and bounded volume. Hide advanced controls under a disclosure and show that speech is generated natively by Seedance.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/audio-caption-controls.test.ts tests/template-recipe-ux.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/video-generation/streamlined-video-studio.tsx src/components/video-generation/audio-caption-controls.tsx tests/audio-caption-controls.test.ts tests/template-recipe-ux.test.ts
git commit -m "feat: add editable native voice and caption controls"
```
