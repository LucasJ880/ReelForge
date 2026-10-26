import assert from "node:assert/strict";
import test from "node:test";
import {
  BGM_TRACKS,
  buildAudioFilterPlan,
  buildDeterministicCues,
  buildTimedCues,
  buildWindowedCues,
  captionWindowsFromSegments,
  planCaptionCues,
  renderAssCaptions,
  renderSrtCaptions,
  splitScriptByDurations,
  splitScriptByWindows,
  type CaptionCue,
  type CaptionWord,
} from "../src/lib/video-generation/audio-post-production";

test("allocates the full probed duration by readable token weight", () => {
  const cues = buildDeterministicCues("第一句。Second sentence!", 8);
  assert.equal(cues[0]?.startMs, 0);
  assert.equal(cues.at(-1)?.endMs, 8_000);
  assert.ok(cues.every((cue) => cue.endMs > cue.startMs));
  assert.deepEqual(
    cues.map((cue) => cue.text).join(""),
    "第一句。Second sentence!",
  );
});

test("caption serialization is deterministic and escapes ASS control text", () => {
  const cues = buildDeterministicCues("新品 {ready}。Try it now!", 6);
  const firstSrt = renderSrtCaptions(cues);
  const secondSrt = renderSrtCaptions(cues);
  assert.equal(firstSrt, secondSrt);
  assert.match(firstSrt, /00:00:00,000/);
  assert.match(firstSrt, /00:00:06,000/);

  const ass = renderAssCaptions(cues, {
    aspectRatio: "9:16",
    position: "bottom",
    style: "word_by_word",
  });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /\\\{ready\\\}/);
  assert.doesNotMatch(ass, /Math\.random/);
});

test("FFmpeg plan ducks licensed BGM under native speech", () => {
  const plan = buildAudioFilterPlan({
    bgmVolume: 0.25,
    hasNativeAudio: true,
    durationSec: 8,
  });
  assert.match(plan.filterComplex, /sidechaincompress/);
  assert.match(plan.filterComplex, /volume=0\.25/);
  assert.match(plan.filterComplex, /atrim=end=8/);
  assert.match(plan.filterComplex, /loudnorm=I=-16:TP=-1\.5/);
  assert.deepEqual(plan.bgmInputArgs, ["-stream_loop", "-1"]);
});

test("licensed BGM catalog has an explicit no-music option and attribution", () => {
  assert.deepEqual(BGM_TRACKS[0], {
    id: "none",
    label: "无配乐",
    path: null,
  });
  assert.deepEqual(BGM_TRACKS[1], {
    id: "wholesome",
    label: "Wholesome",
    path: "scripts/assets/pet-kit-bgm.mp3",
    license: "CC BY 4.0",
    author: "Kevin MacLeod",
  });
});

test("english scripts split at sentence and phrase boundaries, never mid-phrase", () => {
  /// 0804 brand-logo 验收回归：旧逻辑不认 ASCII 句号 + 空格/逗号同权，
  /// 烧出 “Not in this bedroom. Custom blackout / curtains from …” 这类腰斩字幕。
  const script =
    "Morning glare again? Not in this bedroom. Custom blackout curtains from SunnyShutter, measured and made for your exact window. Soft light when you want it, total blackout when you need it.";
  const cues = buildDeterministicCues(script, 14.3);
  assert.deepEqual(
    cues.map((cue) => cue.text),
    [
      "Morning glare again?",
      "Not in this bedroom.",
      "Custom blackout curtains from SunnyShutter,",
      "measured and made for your exact window.",
      "Soft light when you want it,",
      "total blackout when you need it.",
    ],
  );
  assert.ok(cues.every((cue) => cue.text === cue.text.trim()));
  assert.equal(cues.at(-1)?.endMs, 14_300);
});

test("decimal points do not split sentences", () => {
  const cues = buildDeterministicCues("Only $19.99 today. Grab yours now!", 6);
  assert.deepEqual(
    cues.map((cue) => cue.text),
    ["Only $19.99 today.", "Grab yours now!"],
  );
});

// ---------------------------------------------------------------------------
// P04-B：逐词高亮与段窗口
// ---------------------------------------------------------------------------

const ZH_WORDS: CaptionWord[] = [
  { text: "一拧", startMs: 120, endMs: 640 },
  { text: "即开，", startMs: 640, endMs: 1_180 },
  { text: "随时", startMs: 1_400, endMs: 1_900 },
  { text: "补水。", startMs: 1_900, endMs: 2_560 },
  { text: "点击", startMs: 3_050, endMs: 3_500 },
  { text: "下方链接", startMs: 3_500, endMs: 4_120 },
  { text: "立即预约。", startMs: 4_120, endMs: 4_980 },
];

const EN_WORDS: CaptionWord[] = (
  "Morning glare again? Not in this bedroom. Custom blackout curtains from SunnyShutter, measured and made for your exact window."
).split(" ").map((text, index) => ({ text, startMs: index * 420, endMs: index * 420 + 380 }));

const kfTotal = (dialogue: string) =>
  Array.from(dialogue.matchAll(/\\kf(\d+)/gu)).reduce((sum, match) => sum + Number(match[1]), 0);

test("buildTimedCues：按 readableChunks 的断句规则分组，起止取组内首词 / 末词的真实时间，词不被切开", () => {
  const zh = buildTimedCues(ZH_WORDS, { language: "zh-CN" });
  assert.deepEqual(
    zh.map((cue) => cue.text),
    ["一拧即开，随时补水。", "点击下方链接立即预约。"],
  );
  assert.equal(zh[0]?.startMs, 120);
  assert.equal(zh[0]?.endMs, 2_560);
  assert.equal(zh[1]?.startMs, 3_050);
  assert.equal(zh[1]?.endMs, 4_980);
  assert.deepEqual(zh[0]?.words, ZH_WORDS.slice(0, 4));
  assert.deepEqual(zh.map((cue) => cue.index), [1, 2]);

  const en = buildTimedCues(EN_WORDS, { language: "en-US" });
  assert.deepEqual(
    en.map((cue) => cue.text),
    [
      "Morning glare again?",
      "Not in this bedroom.",
      "Custom blackout curtains from SunnyShutter,",
      "measured and made for your exact window.",
    ],
  );
  for (const cue of en) {
    assert.ok(cue.words && cue.words.length > 0);
    assert.equal(cue.startMs, cue.words[0].startMs);
    assert.equal(cue.endMs, Math.max(...cue.words.map((word) => word.endMs)));
    assert.equal(cue.words.map((word) => word.text).join(" "), cue.text, "词原样进 cue，不切开");
  }
  /// 窗口上限：越界的词裁掉 / 截短
  const clipped = buildTimedCues(ZH_WORDS, { maxEndMs: 2_000 });
  assert.deepEqual(clipped.map((cue) => cue.text), ["一拧即开，随时补水。"]);
  assert.equal(clipped[0]?.endMs, 2_000);
  assert.deepEqual(buildTimedCues([]), []);
});

test("karaoke：每词 {\\kf<厘秒>}，厘秒合计等于 cue 时长；Karaoke 样式金前景白底色，Captions 样式原样", () => {
  const cues = buildTimedCues(ZH_WORDS, { language: "zh-CN" });
  const ass = renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style: "karaoke", language: "zh-CN" });
  assert.match(ass, /^Style: Captions,Noto Sans SC,58,&H00FFFFFF,&H0000D7FF,/mu, "Captions 样式不动");
  assert.match(ass, /^Style: Karaoke,Noto Sans SC,58,&H0000D7FF,&H00FFFFFF,/mu, "Karaoke：Primary 金 / Secondary 白");
  assert.match(ass, /^; Language: zh-CN$/mu);
  const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(dialogues.length, cues.length, "karaoke 每个 cue 一条 Dialogue");
  for (const [index, dialogue] of dialogues.entries()) {
    const cue = cues[index];
    assert.match(dialogue, /,Karaoke,,0,0,0,,/u);
    const expectedCs = Math.floor(cue.endMs / 10) - Math.floor(cue.startMs / 10);
    assert.equal(kfTotal(dialogue), expectedCs, `cue ${cue.index} \\kf sum`);
    for (const word of cue.words ?? []) {
      assert.ok(dialogue.includes(`}${word.text}`), `word ${word.text} follows a tag`);
    }
  }
  /// 首词在 cue 起点：没有多余的前导空标签；CJK 词之间不插空格
  assert.match(dialogues[0], /,,\{\\kf\d+\}一拧\{\\kf\d+\}即开，\{\\kf\d+\}随时\{\\kf\d+\}补水。$/u);

  /// 拉丁词之间保留空格
  const en = renderAssCaptions(buildTimedCues(EN_WORDS), { aspectRatio: "16:9", position: "bottom", style: "karaoke", language: "en-US" });
  assert.match(en, /\{\\kf\d+\}Morning \{\\kf\d+\}glare \{\\kf\d+\}again\?/u);
});

test("word_by_word：每词一条 Dialogue，整句在场、只有当前词染金，时间段首尾相接覆盖整个 cue", () => {
  const cues = buildTimedCues(ZH_WORDS.slice(0, 4), { language: "zh-CN" });
  const ass = renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style: "word_by_word", language: "zh-CN" });
  const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(dialogues.length, 4, "四个词 → 四条（首词就在 cue 起点，没有前导空段）");
  assert.match(dialogues[0], /,Captions,,0,0,0,,\{\\1c&H00D7FF&\}一拧\{\\r\}即开，随时补水。$/u);
  assert.match(dialogues[1], /,,一拧\{\\1c&H00D7FF&\}即开，\{\\r\}随时补水。$/u);
  assert.match(dialogues[3], /,,一拧即开，随时\{\\1c&H00D7FF&\}补水。\{\\r\}$/u);
  const times = dialogues.map((line) => line.split(",").slice(1, 3));
  for (let index = 1; index < times.length; index++) {
    assert.equal(times[index][0], times[index - 1][1], "上一词结束 = 下一词开始");
  }
  assert.equal(times[0][0], "0:00:00.12");
  assert.equal(times.at(-1)?.[1], "0:00:02.56");
});

test("ASS 控制字符：词里的 { } 转义后标签仍然正确插入", () => {
  const words: CaptionWord[] = [
    { text: "新品", startMs: 0, endMs: 500 },
    { text: "{ready}", startMs: 500, endMs: 1_000 },
    { text: "上市。", startMs: 1_000, endMs: 1_600 },
  ];
  const cues = buildTimedCues(words, { language: "zh-CN" });
  const karaoke = renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style: "karaoke" });
  assert.match(karaoke, /\{\\kf\d+\}\\\{ready\\\}/u, "转义后的 {ready} 紧跟在 \\kf 标签后");
  const wordByWord = renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style: "word_by_word" });
  assert.match(wordByWord, /\{\\1c&H00D7FF&\}\\\{ready\\\}\{\\r\}/u);
  /// 去掉所有合法标签块后，不该再剩任何未转义的花括号
  for (const ass of [karaoke, wordByWord]) {
    const texts = ass
      .split("\n")
      .filter((line) => line.startsWith("Dialogue:"))
      .map((line) => line.split(",").slice(9).join(","));
    for (const text of texts) {
      const stripped = text.replace(/\{\\[^}]*\}/gu, "").replaceAll("\\{", "").replaceAll("\\}", "");
      assert.doesNotMatch(stripped, /[{}]/u, `unbalanced brace in ${text}`);
    }
  }
});

test("没有逐词时间戳：karaoke / word_by_word 都回退到整句渲染，与 1025 之前完全一致", () => {
  const cues = buildDeterministicCues("一拧即开，随时补水。点击下方链接立即预约。", 6);
  const baseline = renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style: "word_by_word" });
  const karaoke = renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style: "karaoke" });
  const karaokeDialogues = karaoke.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(karaokeDialogues.length, cues.length);
  assert.ok(karaokeDialogues.every((line) => line.includes(",Captions,,") && !line.includes("\\kf")));
  assert.equal(
    karaoke.split("\n").filter((line) => line.startsWith("Dialogue:")).join("\n"),
    baseline.split("\n").filter((line) => line.startsWith("Dialogue:")).join("\n"),
  );
  /// words 为空数组也算没有
  const emptyWords: CaptionCue[] = cues.map((cue) => ({ ...cue, words: [] }));
  assert.doesNotMatch(
    renderAssCaptions(emptyWords, { aspectRatio: "9:16", position: "bottom", style: "karaoke" }),
    /\\kf/u,
  );
  /// plain 有 words 也不高亮
  const timed = buildTimedCues(ZH_WORDS);
  assert.doesNotMatch(
    renderAssCaptions(timed, { aspectRatio: "9:16", position: "bottom", style: "plain" }),
    /\\kf|\\1c/u,
  );
  /// 门控是显式规则：没有 words 就不多一个 Style、不多一行注释——即使传了 language、选了 karaoke
  const gated = renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style: "karaoke", language: "zh-CN" });
  assert.doesNotMatch(gated, /^Style: Karaoke/mu);
  assert.doesNotMatch(gated, /^; Language/mu);
  assert.doesNotMatch(
    renderAssCaptions(timed, { aspectRatio: "9:16", position: "bottom", style: "plain", language: "zh-CN" }),
    /^Style: Karaoke|^; Language/mu,
  );
  /// word_by_word 带 words：行内染色，也不需要 Karaoke 样式
  assert.doesNotMatch(
    renderAssCaptions(timed, { aspectRatio: "9:16", position: "bottom", style: "word_by_word", language: "zh-CN" }),
    /^Style: Karaoke|^; Language/mu,
  );
});

// 改动前（9179ab6）renderAssCaptions 的完整输出，逐字节锁住：没有逐词时间戳时三种样式都不许变
const GOLDEN_PLAIN =
  "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Captions,Noto Sans SC,58,&H00FFFFFF,&H0000D7FF,&H90000000,&H50000000,0,0,0,0,100,100,0,0,1,2,1,2,80,80,150,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:03.03,Captions,,0,0,0,,一拧即开，随时补水。\nDialogue: 0,0:00:03.03,0:00:06.00,Captions,,0,0,0,,点击下方链接立即预约。\n";
const GOLDEN_WORD_BY_WORD =
  "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Captions,Noto Sans SC,58,&H00FFFFFF,&H0000D7FF,&H90000000,&H50000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,150,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:03.03,Captions,,0,0,0,,一拧即开，随时补水。\nDialogue: 0,0:00:03.03,0:00:06.00,Captions,,0,0,0,,点击下方链接立即预约。\n";
const GOLDEN_KARAOKE =
  "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Captions,Noto Sans SC,58,&H00FFFFFF,&H0000D7FF,&H90000000,&H50000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,150,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:03.03,Captions,,0,0,0,,一拧即开，随时补水。\nDialogue: 0,0:00:03.03,0:00:06.00,Captions,,0,0,0,,点击下方链接立即预约。\n";
const GOLDEN_EN_16_9_TOP =
  "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nScaledBorderAndShadow: yes\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Captions,Noto Sans SC,48,&H00FFFFFF,&H0000D7FF,&H90000000,&H50000000,-1,0,0,0,100,100,0,0,1,4,1,8,80,80,90,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.85,Captions,,0,0,0,,Morning glare again?\nDialogue: 0,0:00:01.85,0:00:04.00,Captions,,0,0,0,,Not in this bedroom.\n";

test("golden：没有 words 时 plain / word_by_word / karaoke（带 language）输出与改动前逐字节相等", () => {
  const cues = buildDeterministicCues("一拧即开，随时补水。点击下方链接立即预约。", 6);
  const golden = { plain: GOLDEN_PLAIN, word_by_word: GOLDEN_WORD_BY_WORD, karaoke: GOLDEN_KARAOKE } as const;
  for (const style of ["plain", "word_by_word", "karaoke"] as const) {
    assert.equal(
      renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style, language: "zh-CN" }),
      golden[style],
      `${style} with language`,
    );
    assert.equal(
      renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style }),
      golden[style],
      `${style} without language`,
    );
  }
  const en = buildDeterministicCues("Morning glare again? Not in this bedroom.", 4);
  assert.equal(
    renderAssCaptions(en, { aspectRatio: "16:9", position: "top", style: "word_by_word", language: "en-US" }),
    GOLDEN_EN_16_9_TOP,
  );
});

test("buildTimedCues 边界：只有标点的 token 贴前一个词不加空格；cue 尾截到下一句开口；word_by_word 同厘秒起点至少 1cs", () => {
  /// 供应商常把标点单独给一个 token
  const punctuated = buildTimedCues(
    [
      { text: "Hello", startMs: 0, endMs: 400 },
      { text: ",", startMs: 400, endMs: 420 },
      { text: "world", startMs: 500, endMs: 900 },
      { text: ".", startMs: 900, endMs: 910 },
    ],
    { language: "en-US" },
  );
  assert.deepEqual(punctuated.map((cue) => cue.text), ["Hello, world."]);
  assert.deepEqual(
    punctuated[0]?.words?.map((word) => word.text),
    ["Hello,", "world."],
    "标点并进前一个词，不占独立高亮段",
  );
  assert.equal(punctuated[0]?.words?.[0]?.endMs, 420, "并入后词尾取标点尾");
  const karaoke = renderAssCaptions(punctuated, { aspectRatio: "16:9", position: "bottom", style: "karaoke", language: "en-US" });
  assert.match(karaoke, /\{\\kf\d+\}Hello, \{\\kf\d+\}world\.$/mu);

  /// 上一句的词尾拖过了下一句的开口：cue 尾截到下一句 startMs
  const overlapping = buildTimedCues(
    [
      { text: "第一句。", startMs: 0, endMs: 1_500 },
      { text: "第二句。", startMs: 1_200, endMs: 2_400 },
    ],
    { language: "zh-CN" },
  );
  assert.equal(overlapping.length, 2);
  assert.equal(overlapping[0]?.endMs, 1_200);
  assert.equal(overlapping[1]?.startMs, 1_200);

  /// 两个词同一厘秒起点：word_by_word 每个词仍各有 ≥1cs 的 Dialogue，首尾相接
  const sameStart = buildTimedCues(
    [
      { text: "一拧", startMs: 1_000, endMs: 1_000 },
      { text: "即开。", startMs: 1_004, endMs: 1_600 },
    ],
    { language: "zh-CN" },
  );
  const ass = renderAssCaptions(sameStart, { aspectRatio: "9:16", position: "bottom", style: "word_by_word", language: "zh-CN" });
  const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(dialogues.length, 2);
  assert.match(dialogues[0], /^Dialogue: 0,0:00:01\.00,0:00:01\.01,/u);
  assert.match(dialogues[1], /^Dialogue: 0,0:00:01\.01,0:00:01\.60,/u);
});

test("planCaptionCues：台词优先用派发 chunk；没有 chunk 按计划时长切；窗口位置按实测；裁尾后实测不等长字幕 chunk 仍等于派发 chunk", () => {
  const script =
    "Morning glare again? Not in this bedroom. Custom blackout curtains from SunnyShutter, measured and made for your exact window. Soft light when you want it, total blackout when you need it. Book a free measure today.";
  /// 派发：三个 AI 段计划各 15s（当前规划器恒 15s）
  const dispatchChunks = splitScriptByDurations(script, [15, 15, 15]);
  assert.equal(dispatchChunks.length, 3);
  /// 合成：语音安全裁尾后实测 14.2 / 15 / 13.6
  const segments = [
    { durationSec: 14.2, plannedDurationSec: 15, captioned: true },
    { durationSec: 15, plannedDurationSec: 15, captioned: true },
    { durationSec: 13.6, plannedDurationSec: 15, captioned: true },
  ];
  const windows = [
    [0, 14_200],
    [14_200, 29_200],
    [29_200, 42_800],
  ] as const;
  const textIn = (cues: CaptionCue[], [startMs, endMs]: readonly [number, number]) =>
    cues
      .filter((cue) => cue.startMs >= startMs && cue.endMs <= endMs)
      .map((cue) => cue.text)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
  const squash = (value: string) => value.replace(/\s+/gu, " ").trim();

  const withChunks = planCaptionCues({ script, segments, captionSpanSec: 42.8, voiceoverChunks: dispatchChunks });
  assert.equal(withChunks.source, "chunks");
  const withoutChunks = planCaptionCues({ script, segments, captionSpanSec: 42.8 });
  assert.equal(withoutChunks.source, "planned");
  for (const [index, window] of windows.entries()) {
    assert.equal(textIn(withChunks.cues, window), squash(dispatchChunks[index]), `chunks path, window ${index}`);
    assert.equal(textIn(withoutChunks.cues, window), squash(dispatchChunks[index]), `planned path, window ${index}`);
  }
  /// 每个 cue 都落在某个实测窗口里（位置按实测，不按计划）
  for (const cue of [...withChunks.cues, ...withoutChunks.cues]) {
    assert.ok(windows.some(([s, e]) => cue.startMs >= s && cue.endMs <= e), `cue [${cue.startMs}, ${cue.endMs}]`);
  }
  assert.equal(withChunks.cues.at(-1)?.endMs, 42_800);

  /// chunk 数与背字幕的段数对不上（assembly 跳过了一个 AI 段）→ 不敢用，按计划时长重切
  const mismatch = planCaptionCues({ script, segments: segments.slice(0, 2), captionSpanSec: 29.2, voiceoverChunks: dispatchChunks });
  assert.equal(mismatch.source, "planned");
  /// 中间夹上传片段：它不开窗、不背字幕；没有计划时长的段退回实测
  const mixed = planCaptionCues({
    script,
    segments: [
      { durationSec: 5, captioned: true },
      { durationSec: 3, captioned: false },
      { durationSec: 15, captioned: true },
    ],
    captionSpanSec: 23,
  });
  assert.equal(mixed.source, "planned");
  assert.ok(mixed.cues.every((cue) => cue.endMs <= 5_000 || (cue.startMs >= 8_000 && cue.endMs <= 23_000)));
  /// 字幕窗口（主片 20s）裁掉尾部
  assert.ok(planCaptionCues({ script, segments, captionSpanSec: 20 }).cues.every((cue) => cue.endMs <= 20_000));
  /// 没有背字幕的段（b-roll）→ 整片均分
  const uniform = planCaptionCues({
    script,
    segments: [{ durationSec: 4, captioned: false }, { durationSec: 4, captioned: false }],
    captionSpanSec: 8,
  });
  assert.equal(uniform.source, "uniform");
  assert.equal(uniform.cues.at(-1)?.endMs, 8_000);
});

test("buildWindowedCues：每段只背自己那句、段内按字重均分、任何 cue 不跨段", () => {
  const windows = [
    { startMs: 0, endMs: 5_000 },
    { startMs: 5_000, endMs: 20_000 },
    { startMs: 23_000, endMs: 28_000 },
  ];
  const chunks = [
    "先看它如何改变日常。",
    "一拧即开，随时补水，轻巧便携，单手开盖，通勤路上再也不漏水。",
    "点击下方链接立即预约。",
  ];
  const cues = buildWindowedCues(chunks, windows);
  assert.ok(cues.length >= 4);
  assert.deepEqual(cues.map((cue) => cue.index), cues.map((_, index) => index + 1));
  for (const cue of cues) {
    const home = windows.find((window) => cue.startMs >= window.startMs && cue.endMs <= window.endMs);
    assert.ok(home, `cue ${cue.index} [${cue.startMs}, ${cue.endMs}] crosses a window`);
    assert.ok(cue.endMs > cue.startMs);
  }
  /// 每个窗口的字幕文本拼起来就是该段的台词；窗口铺满
  for (const [index, window] of windows.entries()) {
    const inWindow = cues.filter((cue) => cue.startMs >= window.startMs && cue.endMs <= window.endMs);
    assert.equal(inWindow.map((cue) => cue.text).join(""), chunks[index].replace(/\s+/gu, ""));
    assert.equal(inWindow[0]?.startMs, window.startMs);
    assert.equal(inWindow.at(-1)?.endMs, window.endMs);
  }
  /// 窗口之间的空档（22s 的上传片段）没有字幕
  assert.ok(cues.every((cue) => cue.endMs <= 20_000 || cue.startMs >= 23_000));
  /// 空台词的段不出字幕；多出来的 chunk 并进最后一个窗
  assert.deepEqual(buildWindowedCues(["", "只有第二段。"], windows.slice(0, 2)).map((cue) => cue.startMs), [5_000]);
  const extra = buildWindowedCues(["一。", "二。", "三。", "四。"], windows.slice(0, 3));
  assert.equal(extra.filter((cue) => cue.startMs >= 23_000).map((cue) => cue.text).join(""), "三。四。");
  assert.throws(() => buildWindowedCues(["x"], [{ startMs: 5, endMs: 5 }]));
});

test("splitScriptByWindows + captionWindowsFromSegments：按段时长加权切台词；窗口按累计偏移、只给 AI 段、裁到字幕窗口", () => {
  const segments = [
    { durationSec: 5, captioned: true },
    { durationSec: 3, captioned: false },
    { durationSec: 15, captioned: true },
    { durationSec: 2.5, captioned: false },
  ];
  assert.deepEqual(captionWindowsFromSegments(segments), [
    { startMs: 0, endMs: 5_000 },
    { startMs: 8_000, endMs: 23_000 },
  ]);
  assert.deepEqual(captionWindowsFromSegments(segments, 20_000), [
    { startMs: 0, endMs: 5_000 },
    { startMs: 8_000, endMs: 20_000 },
  ]);
  assert.deepEqual(captionWindowsFromSegments(segments, 7_000), [{ startMs: 0, endMs: 5_000 }]);
  assert.deepEqual(captionWindowsFromSegments([]), []);

  const script = Array.from({ length: 20 }, (_, i) => ["一拧即开", "随时补水", "轻巧便携", "单手开盖"][i % 4]).join("，") + "。";
  const chunks = splitScriptByWindows(script, captionWindowsFromSegments(segments));
  assert.equal(chunks.length, 2);
  assert.equal(chunks.join(""), script);
  const ratio = Array.from(chunks[1]).length / Array.from(chunks[0]).length;
  assert.ok(ratio >= 2.5 && ratio <= 3.5, `ratio ${ratio}`);
  assert.deepEqual(splitScriptByWindows("", [{ startMs: 0, endMs: 1 }]), [""]);
  assert.deepEqual(splitScriptByWindows("x", []), []);
});
