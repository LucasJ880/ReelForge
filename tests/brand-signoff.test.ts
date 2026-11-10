import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CJK_FONT_FAMILY } from "@/lib/media/media-fonts";
import { buildTimelineFilterGraph } from "@/lib/media/stitch-pipeline";
import { postProductionPlanSchema } from "@/lib/schemas/unified-input";
import {
  SIGNOFF_BRAND_MAX,
  SIGNOFF_DURATION_SEC,
  SIGNOFF_FONT_FAMILY,
  renderSignoffAss,
  signoffActive,
  signoffGeometry,
  signoffSettingsSchema,
  signoffWindow,
} from "@/lib/video-generation/brand-signoff";
import {
  RestitchRejectedError,
  mergeRestitchPatch,
  parseRestitchPatch,
  restitchPatchIsNoop,
} from "@/lib/video-generation/restitch-patch";
import type { PostProductionPlan } from "@/types/video-generation";

/**
 * 片尾落款（2026-11-10）：最后约两秒在真实画面上压品牌名 + 行动指引。守住：
 * 默认不带、不压到字幕和尾卡上、商家写的字不能变成 ASS 指令、没勾时合成结果与之前逐字节一致、
 * 只取商家自己的品牌名预填（不取全局包）。
 */
const BASE: PostProductionPlan = {
  audio: {
    voiceover: { enabled: true, voiceId: "default", language: "zh-CN", script: "卷口一扣，接着走。" },
    bgm: { trackId: "none", volume: 0 },
  },
  captions: { enabled: true, style: "plain", language: "zh-CN", position: "bottom", exportSrt: false },
};

test("设置校验：开着就要有品牌名；关着可以空；超长与多余字段拒绝", () => {
  assert.equal(signoffSettingsSchema.safeParse({ enabled: true, brandName: "  " }).success, false);
  assert.equal(signoffSettingsSchema.safeParse({ enabled: false, brandName: "" }).success, true);
  assert.deepEqual(signoffSettingsSchema.parse({ enabled: true, brandName: " NORDA ", cta: " 主页看更多 " }), {
    enabled: true,
    brandName: "NORDA",
    cta: "主页看更多",
  });
  assert.equal(signoffSettingsSchema.safeParse({ enabled: true, brandName: "牌".repeat(SIGNOFF_BRAND_MAX + 1) }).success, false);
  assert.equal(signoffSettingsSchema.safeParse({ enabled: true, brandName: "NORDA", phone: "123" }).success, false);
  assert.equal(signoffActive(null), false);
  assert.equal(signoffActive({ enabled: false, brandName: "NORDA" }), false);
  assert.equal(signoffActive({ enabled: true, brandName: "NORDA" }), true);
});

test("后期快照：旧快照没有落款照常解析；带落款的也认", () => {
  assert.equal(postProductionPlanSchema.parse(BASE).signoff, undefined);
  const withSignoff = postProductionPlanSchema.parse({ ...BASE, signoff: { enabled: true, brandName: "NORDA", cta: null } });
  assert.deepEqual(withSignoff.signoff, { enabled: true, brandName: "NORDA", cta: null });
});

test("时间窗：主片段最后两秒多；有尾卡类片段时不压到尾卡上；太短的片子不落款", () => {
  assert.deepEqual(signoffWindow(15), { startSec: 15 - SIGNOFF_DURATION_SEC, endSec: 15 });
  assert.deepEqual(signoffWindow(17, 15), { startSec: 15 - SIGNOFF_DURATION_SEC, endSec: 15 });
  assert.equal(signoffWindow(4), null);
  assert.equal(signoffWindow(20, 5), null);
});

test("落点：字幕在底部时紧挨字幕上方、不往上压到画面中间；抖音让开底部界面；字幕不在底部就贴近下沿", () => {
  const bottom = signoffGeometry({ width: 1080, height: 1920, captionPosition: "bottom" });
  assert.equal(bottom.x, 540);
  /// 字幕块顶边 ≈ 1920 - 150 - 两行；落款底边在它上面，但仍在画面下方四分之一里
  assert.ok(bottom.y < 1920 - 150 - 150, `落款底边 ${bottom.y} 应在字幕块之上`);
  assert.ok(bottom.y > 1920 * 0.72, `落款 ${bottom.y} 不该压到画面中间`);
  const douyin = signoffGeometry({ width: 1080, height: 1920, captionPosition: "bottom", platform: "douyin" });
  assert.ok(douyin.y < bottom.y, "抖音底部有界面遮挡，落款跟着字幕一起上移");
  assert.ok(douyin.y < 1920 * 0.72);
  const captionsTop = signoffGeometry({ width: 1080, height: 1920, captionPosition: "top" });
  const captionsOff = signoffGeometry({ width: 1080, height: 1920, captionPosition: null });
  assert.equal(captionsTop.y, captionsOff.y);
  assert.ok(captionsTop.y > bottom.y, "底部没有字幕时落款贴近下沿");
  assert.ok(captionsTop.y <= 1920 * 0.9);
  assert.ok(bottom.ctaFontSize < bottom.brandFontSize);
});

test("渲染：品牌名一行、行动指引一行；商家写的花括号、反斜杠、换行不会变成 ASS 指令；与字幕同一套字", () => {
  const ass = renderSignoffAss({
    width: 1080,
    height: 1920,
    captionPosition: "bottom",
    brandName: "NORDA{\\fs200}\n户外",
    cta: "主页\\N看更多",
    startSec: 12.8,
    endSec: 15,
  });
  const event = ass.split("\n").find((line) => line.startsWith("Dialogue:"))!;
  assert.match(event, /^Dialogue: 8,0:00:12\.80,0:00:16\.00,Signoff,/);
  assert.match(event, /\{\\an2\\pos\(540,\d+\)\\fad\(250,0\)\}\{\\b1\}NORDAfs200户外\{\\b0\}\\N\{\\fs\d+\}主页N看更多$/);
  const noCta = renderSignoffAss({ width: 1080, height: 1920, brandName: "NORDA", cta: null, startSec: 10, endSec: 12 });
  assert.ok(noCta.split("\n").find((line) => line.startsWith("Dialogue:"))!.endsWith("{\\b1}NORDA{\\b0}"));
  assert.equal(SIGNOFF_FONT_FAMILY, CJK_FONT_FAMILY);
  assert.match(ass, new RegExp(`Style: Signoff,${CJK_FONT_FAMILY},`));
});

test("合成滤镜串：没勾落款时与之前逐字节一致；勾了就在字幕与角标之后再叠一层", () => {
  const args = {
    clips: [{ videoInput: 0, audioInput: 0, frames: 375, samples: 720_000 }],
    width: 1080,
    height: 1920,
    fps: "25",
    ass: { path: "/tmp/w/captions.ass", fontsDir: "/fonts" },
    audioPlanFilter: null,
    audioPlanOutput: null,
  };
  const plain = buildTimelineFilterGraph(args);
  assert.deepEqual(buildTimelineFilterGraph({ ...args, signoffAss: null }), plain);
  const signed = buildTimelineFilterGraph({ ...args, signoffAss: { path: "/tmp/w/brand-signoff.ass", fontsDir: "/fonts" } });
  assert.equal(signed.videoLabel, "[vsign]");
  assert.ok(signed.filterComplex.startsWith(plain.filterComplex));
  assert.match(signed.filterComplex, /\[vout\]ass=filename='\/tmp\/w\/brand-signoff\.ass':fontsdir='\/fonts'\[vsign\]$/);
  const withBadge = buildTimelineFilterGraph({
    ...args,
    badgeAss: { path: "/tmp/w/ai-badge.ass", fontsDir: "/fonts" },
    signoffAss: { path: "/tmp/w/brand-signoff.ass", fontsDir: "/fonts" },
  });
  assert.match(withBadge.filterComplex, /\[vbadge\]ass=filename='\/tmp\/w\/brand-signoff\.ass'/);
});

test("只重拼：可以只改落款；口播仍然不能在这里改；落款关着的两份视为没有改动", () => {
  const patch = parseRestitchPatch({ signoff: { enabled: true, brandName: "NORDA", cta: "主页看更多" } });
  const merged = mergeRestitchPatch(BASE, patch);
  assert.deepEqual(merged.signoff, { enabled: true, brandName: "NORDA", cta: "主页看更多" });
  assert.deepEqual(merged.captions, BASE.captions);
  assert.equal(restitchPatchIsNoop(BASE, merged), false);

  /// 关掉落款：再重拼一次，回到没有落款
  const off = mergeRestitchPatch(merged, parseRestitchPatch({ signoff: { enabled: false, brandName: "NORDA" } }));
  assert.equal(restitchPatchIsNoop(merged, off), false);
  assert.equal(restitchPatchIsNoop(BASE, off), true, "关着的落款 = 没有落款");
  /// 没带落款的补丁沿用旧落款；旧快照没有落款就不多出这个键
  const captionsOnly = mergeRestitchPatch(merged, parseRestitchPatch({ captions: { ...BASE.captions, position: "top" } }));
  assert.deepEqual(captionsOnly.signoff, merged.signoff);
  assert.equal("signoff" in mergeRestitchPatch(BASE, parseRestitchPatch({ captions: BASE.captions })), false);

  assert.throws(() => parseRestitchPatch({ signoff: { enabled: true, brandName: "" } }), RestitchRejectedError);
  assert.throws(() => parseRestitchPatch({}), RestitchRejectedError);
  assert.throws(
    () => parseRestitchPatch({ signoff: { enabled: true, brandName: "NORDA" }, voiceover: { script: "x" } }),
    (error: unknown) => error instanceof RestitchRejectedError && error.code === "INVALID_STATE",
  );
});

test("界面：默认不带；落款有变化才提交；预填只取商家自己工作区的品牌包", async () => {
  const form = await readFile("src/components/library/restitch-form.tsx", "utf8");
  assert.match(form, /useState\(Boolean\(savedSignoff\?\.enabled\)\)/);
  assert.match(form, /\.\.\.\(signoffChanged\s*\? \{ signoff: \{ enabled: signoffEnabled, brandName: signoffBrand\.trim\(\), cta: signoffCta\.trim\(\) \|\| null \} \}\s*: \{\}\)/);
  assert.match(form, /disabled=\{unchanged \|\| submitting \|\| pending \|\| signoffInvalid\}/);
  const detail = await readFile("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(detail, /packages\.filter\(\(entry\) => entry\.scope === "workspace"\)/);
  const pipeline = await readFile("src/lib/media/stitch-pipeline.ts", "utf8");
  assert.match(pipeline, /signoffActive\(signoff\) \? signoffWindow\(totalSec, captionWindowSec\) : null/);
  assert.match(pipeline, /"SIGNOFF_FONT_MISSING"/);
});

test("创作时就勾落款：随请求进方案的后期快照；没勾时快照里不多这个键", async () => {
  const { normalizePostProductionSettings } = await import("@/lib/video-generation/generation-supervisor");
  const { unifiedVideoGenerationRequestSchema } = await import("@/lib/schemas/unified-input");
  const request = {
    userType: "platform" as const,
    rawPrompt: "橄榄色蜡帆布卷口背包，拍一个人在山路上停下来拿出外套穿上。",
    attachments: [],
    selectedDuration: 15 as const,
    selectedAspectRatio: "9:16" as const,
    selectedBrandEndingMode: "none" as const,
    language: "zh-CN",
  };
  const plain = normalizePostProductionSettings(request);
  assert.equal("signoff" in plain, false);

  const signed = normalizePostProductionSettings({ ...request, signoff: { enabled: true, brandName: " NORDA ", cta: " 主页看更多 " } });
  assert.deepEqual(signed.signoff, { enabled: true, brandName: "NORDA", cta: "主页看更多" });
  assert.deepEqual({ ...signed, signoff: undefined }, { ...plain, signoff: undefined }, "除了落款，其余后期设置不变");
  /// 关着的、没品牌名的都不进快照
  assert.equal("signoff" in normalizePostProductionSettings({ ...request, signoff: { enabled: false, brandName: "NORDA" } }), false);
  assert.equal("signoff" in normalizePostProductionSettings({ ...request, signoff: { enabled: true, brandName: "  " } }), false);
  /// 快照能被落库时用的校验原样解析回来
  assert.deepEqual(postProductionPlanSchema.parse(signed).signoff, signed.signoff);

  assert.equal(unifiedVideoGenerationRequestSchema.safeParse({ ...request, signoff: { enabled: true, brandName: "NORDA" } }).success, true);
  assert.equal(unifiedVideoGenerationRequestSchema.safeParse({ ...request, signoff: { enabled: true, brandName: "" } }).success, false);
  assert.equal(unifiedVideoGenerationRequestSchema.safeParse(request).success, true);
});

test("创作页：落款默认不带、预填只取自己工作区的品牌包、没勾时请求里没有这个键、勾了没填品牌名不让提交", async () => {
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /const \[signoffEnabled, setSignoffEnabled\] = useState\(false\);/);
  assert.match(studio, /brandPackages\.filter\(\(entry\) => entry\.scope === "workspace"\)/);
  assert.match(
    studio,
    /\.\.\.\(signoffEnabled && signoffBrand\.trim\(\)\s*\? \{ signoff: \{ enabled: true, brandName: signoffBrand\.trim\(\), cta: signoffCta\.trim\(\) \|\| null \} \}\s*: \{\}\)/,
  );
  assert.match(studio, /if \(signoffEnabled && !signoffBrand\.trim\(\)\) return copy\.signoffRequired;/);
  assert.match(studio, /data-testid="streamlined-signoff"/);
  /// 派发时落库的是服务端按请求重建的方案（不是客户端传来的那份）
  const dispatch = await readFile("src/app/api/video-generation/dispatch/route.ts", "utf8");
  assert.match(dispatch, /videoGenerationPlan: plan as unknown as object,/);
});
