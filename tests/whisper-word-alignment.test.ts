/**
 * whisper 词级对齐模块（scripts/lib/whisper-align.ts）的纯函数测试。
 * 不启动 whisper-cli / ffmpeg：夹具全部内联（token 字节片、ASS 文本、已知偏差的词序列）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  alignWordStarts,
  cuesToReferenceUnits,
  dtwPresetForModel,
  lcsAlign,
  mergeWhisperTokens,
  normalizeUnitText,
  parseAssCues,
  parseAssDialogueText,
  parseAssTimestamp,
  parseWhisperFullJson,
  percentile,
  splitUnits,
  wordScriptForLanguage,
  type AlignUnit,
  type RawWhisperToken,
  type TimedWord,
} from "../scripts/lib/whisper-align";

function tok(text: string | number[], startMs: number, endMs: number, dtwMs: number | null = null): RawWhisperToken {
  return {
    bytes: typeof text === "string" ? Buffer.from(text, "utf8") : Buffer.from(text),
    startMs,
    endMs,
    dtwMs,
  };
}

/// 「每一块百叶都能完全折回。」的 whisper token 流：首字拆成两个字节片、「完全」合成一个 token、
/// 含句号与 [_BEG_]/[_TT_] 特殊 token（与本机 whisper-cli 1.9.1 的真实输出形态一致）。
const ZH_TOKENS: RawWhisperToken[] = [
  tok("[_BEG_]", 0, 0),
  tok([0xe6], 10, 120), // 每 的第 1 字节
  tok([0xaf, 0x8f], 120, 230), // 每 的第 2–3 字节
  tok("一", 230, 460),
  tok("块", 460, 690),
  tok("百", 690, 920),
  tok("叶", 920, 1140),
  tok("都", 1140, 1370),
  tok("能", 1370, 1600),
  tok("完全", 1600, 2060),
  tok("折", 2060, 2280),
  tok("回", 2280, 2440),
  tok("。", 2480, 2480),
  tok("[_TT_128]", 2560, 2560),
];

test("CJK：字节片合并成字、双字 token 线性均分、标点与特殊 token 跳过", () => {
  const words = mergeWhisperTokens(ZH_TOKENS);
  assert.equal(words.map((w) => w.text).join(""), "每一块百叶都能完全折回");
  assert.deepEqual(words[0], { text: "每", startMs: 10, endMs: 230 });
  assert.deepEqual(words[1], { text: "一", startMs: 230, endMs: 460 });
  const wan = words.find((w) => w.text === "完");
  const quan = words.find((w) => w.text === "全");
  assert.deepEqual(wan, { text: "完", startMs: 1600, endMs: 1830 });
  assert.deepEqual(quan, { text: "全", startMs: 1830, endMs: 2060 });
  assert.equal(words[words.length - 1].text, "回");
});

test("CJK 混排：连续数字/拉丁字母合成一个单元，汉字各自成字", () => {
  const words = mergeWhisperTokens([
    tok("安", 0, 200),
    tok("装", 200, 400),
    tok(" 15", 400, 700),
    tok("分", 700, 900),
    tok("钟", 900, 1100),
    tok(" iPhone", 1100, 1600),
  ]);
  assert.deepEqual(
    words.map((w) => w.text),
    ["安", "装", "15", "分", "钟", "iPhone"],
  );
  assert.deepEqual(words[2], { text: "15", startMs: 400, endMs: 700 });
  assert.equal(splitUnits("安装15分钟 iPhone").join("|"), "安|装|15|分|钟|iPhone");
});

test("英文：前导空格开新词，子词片拼回整词，词内撇号保留", () => {
  const words = mergeWhisperTokens([
    tok("[_BEG_]", 0, 0),
    tok(" Every", 110, 420),
    tok(" panel", 420, 840),
    tok(" don", 840, 950),
    tok("'t", 950, 1000),
    tok(" A", 1100, 1150),
    tok("ry", 1150, 1250),
    tok("ph", 1250, 1300),
    tok(".", 1300, 1300),
  ]);
  assert.deepEqual(
    words.map((w) => w.text),
    ["Every", "panel", "don't", "Aryph"],
  );
  assert.deepEqual(words[2], { text: "don't", startMs: 840, endMs: 1000 });
  assert.deepEqual(words[3], { text: "Aryph", startMs: 1100, endMs: 1300 });
});

test("whisper full JSON：非法 UTF-8 的字节片 token 仍能解析，t_dtw ≥ 0 优先于 offsets", () => {
  const raw = Buffer.concat([
    Buffer.from(
      '{"transcription":[{"text":" 每一","offsets":{"from":0,"to":460},"tokens":[' +
        '{"text":"[_BEG_]","offsets":{"from":0,"to":0},"t_dtw":-1},' +
        '{"text":"',
      "utf8",
    ),
    Buffer.from([0xe6]),
    Buffer.from('","offsets":{"from":10,"to":120},"t_dtw":2},{"text":"', "latin1"),
    Buffer.from([0xaf, 0x8f]),
    Buffer.from(
      '","offsets":{"from":120,"to":230},"t_dtw":-1},' +
        '{"text":"一","offsets":{"from":230,"to":460},"t_dtw":-1}]}]}',
      "utf8",
    ),
  ]);
  // 文件整体不是合法 UTF-8（0xE6 与 0xAF 0x8F 被 JSON 字面量隔开）
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(raw));

  const parsed = parseWhisperFullJson(raw);
  assert.equal(parsed.text, "每一");
  assert.equal(parsed.timingSource, "dtw");
  assert.equal(parsed.tokens.length, 4);
  const words = mergeWhisperTokens(parsed.tokens);
  assert.deepEqual(words, [
    { text: "每", startMs: 20, endMs: 230 }, // t_dtw=2 → 20ms
    { text: "一", startMs: 230, endMs: 460 },
  ]);
});

test("语言 → 切分策略；模型名 → -dtw 预设", () => {
  assert.equal(wordScriptForLanguage("zh"), "cjk");
  assert.equal(wordScriptForLanguage("zh-CN"), "cjk");
  assert.equal(wordScriptForLanguage("ja"), "cjk");
  assert.equal(wordScriptForLanguage("en"), "latin");
  assert.equal(wordScriptForLanguage("fr"), "latin");
  assert.equal(dtwPresetForModel("/x/ggml-small.bin"), "small");
  assert.equal(dtwPresetForModel("ggml-base.en.bin"), "base.en");
  assert.equal(dtwPresetForModel("ggml-large-v3-turbo.bin"), "large.v3.turbo");
  assert.equal(dtwPresetForModel("whatever.bin"), "small");
});

const ASS_FIXTURE = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour
Style: Captions,Noto Sans SC,58,&H00FFFFFF

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:03.20,Captions,,0,0,0,,每一块百叶，都能完全折回
Comment: 0,0:00:00.00,0:00:01.00,Captions,,0,0,0,,ignored line
Dialogue: 0,0:00:04.00,0:00:06.00,Captions,,0,0,0,,{\\kf25}Every {\\kf30}panel {\\k20}folds{\\kf40} back\\Nfull \\{view\\}
Dialogue: 0,0:01:02.07,0:01:03.00,Captions,,0,0,0,,{\\pos(540,1700)}Hello, world
`;

test("ASS 时间戳：厘秒与毫秒两种写法", () => {
  assert.equal(parseAssTimestamp("0:00:01.50"), 1500);
  assert.equal(parseAssTimestamp("0:01:02.07"), 62070);
  assert.equal(parseAssTimestamp("00:00:01,250"), 1250);
  assert.throws(() => parseAssTimestamp("1.5s"));
});

test("ASS 解析：Dialogue 文本里的逗号、Comment 跳过、\\N 与转义大括号", () => {
  const cues = parseAssCues(ASS_FIXTURE);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { startMs: 1500, endMs: 3200, text: "每一块百叶，都能完全折回" });
  assert.equal(cues[2].text, "Hello, world");
  assert.equal(cues[2].words, undefined);
});

test("ASS karaoke：\\kf / \\k 按厘秒累加出逐词起点", () => {
  const cues = parseAssCues(ASS_FIXTURE);
  const cue = cues[1];
  assert.equal(cue.startMs, 4000);
  assert.equal(cue.text, "Every panel folds back full {view}");
  assert.deepEqual(cue.words, [
    { text: "Every", startMs: 4000, endMs: 4250 },
    { text: "panel", startMs: 4250, endMs: 4550 },
    { text: "folds", startMs: 4550, endMs: 4750 },
    { text: "back full {view}", startMs: 4750, endMs: 5150 },
  ] satisfies TimedWord[]);

  // 连续两个标签（空音节）只推进时间；首标签之前的文本落在 cue 起点、零时长
  const leading = parseAssDialogueText("前{\\kf10}{\\kf20}后", 1000);
  assert.deepEqual(leading.words, [
    { text: "前", startMs: 1000, endMs: 1000 },
    { text: "后", startMs: 1100, endMs: 1300 },
  ]);
});

test("参考单元：有 karaoke 时每个音节首单元带起点；没有时只有 cue 首单元带起点", () => {
  const cues = parseAssCues(ASS_FIXTURE);
  const units = cuesToReferenceUnits(cues);
  const zh = units.slice(0, 11);
  assert.equal(zh.map((u) => u.text).join(""), "每一块百叶都能完全折回");
  assert.equal(zh[0].startMs, 1500);
  assert.ok(zh.slice(1).every((u) => u.startMs === null));

  const en = units.slice(11, 17);
  assert.deepEqual(
    en.map((u) => [u.text, u.startMs]),
    [["Every", 4000], ["panel", 4250], ["folds", 4550], ["back", 4750], ["full", null], ["view", null]],
  );
});

function timed(words: Array<[string, number]>): TimedWord[] {
  return words.map(([text, startMs]) => ({ text, startMs, endMs: startMs + 200 }));
}

const REFERENCE: AlignUnit[] = [
  ["Every", 100], ["panel", 400], ["folds", 800], ["back", 1200], ["whenever", 1500],
  ["you", 1900], ["want", 2100], ["the", 2300], ["full", 2500], ["view", 2800],
].map(([text, startMs]) => ({ text: text as string, startMs: startMs as number }));

test("LCS 对齐是单调的，比较键忽略大小写与标点", () => {
  assert.equal(normalizeUnitText("Hello,"), "hello");
  assert.equal(normalizeUnitText("１５"), "15");
  assert.deepEqual(lcsAlign(["a", "b", "c", "d"], ["b", "c", "x", "d"]), [[1, 0], [2, 1], [3, 3]]);
  // 两个同长的 LCS（a-c 或 b-c）：只要求结果单调且长度正确
  const tie = lcsAlign(["a", "b", "c"], ["b", "a", "c"]);
  assert.equal(tie.length, 2);
  assert.ok(tie.every(([r, h], k) => k === 0 || (r > tie[k - 1][0] && h > tie[k - 1][1])));
  assert.deepEqual(lcsAlign(["a", "", "c"], ["", "c"]), [[2, 1]]);
});

test("偏差统计：P50 / P95 nearest-rank、150ms 门、未匹配比例", () => {
  const offsets = [20, 30, -40, 50, 60, 70, -80, 90, 100, 400];
  const hypothesis = timed(
    REFERENCE.map((unit, index) => [unit.text.toLowerCase(), (unit.startMs ?? 0) + offsets[index]]),
  );
  const report = alignWordStarts(REFERENCE, hypothesis);
  assert.equal(report.n, 10);
  assert.equal(report.p50, 60);
  assert.equal(report.p95, 400);
  assert.equal(report.maxMs, 400);
  assert.equal(report.unmatchedRatio, 0);
  assert.equal(report.textMatchRatio, 1);
  assert.equal(report.passes150ms, false);

  // 转写多了一个「um」、漏了「the」：仍单调匹配 9 个；P95 仍是 400（第 9/9 名）
  const noisy: TimedWord[] = [
    ...hypothesis.slice(0, 4),
    { text: "um", startMs: 1400, endMs: 1450 },
    ...hypothesis.slice(4, 7),
    ...hypothesis.slice(8),
  ];
  const noisyReport = alignWordStarts(REFERENCE, noisy);
  assert.equal(noisyReport.n, 9);
  assert.equal(noisyReport.matchedUnits, 9);
  assert.equal(noisyReport.hypUnits, 10);
  assert.ok(Math.abs(noisyReport.unmatchedRatio - 0.1) < 1e-9);
  assert.equal(noisyReport.p95, 400);
  assert.equal(noisyReport.passes150ms, false);

  // 全部 < 150ms → 过门
  const tight = timed(REFERENCE.map((unit) => [unit.text, (unit.startMs ?? 0) + 90]));
  const tightReport = alignWordStarts(REFERENCE, tight);
  assert.equal(tightReport.p95, 90);
  assert.equal(tightReport.passes150ms, true);

  // 自定义阈值
  assert.equal(alignWordStarts(REFERENCE, tight, { thresholdMs: 80 }).passes150ms, false);

  // 没有可测的对：n=0、不过门、未匹配 = 1
  const empty = alignWordStarts(REFERENCE, []);
  assert.equal(empty.n, 0);
  assert.equal(empty.p95, null);
  assert.equal(empty.passes150ms, false);
  assert.equal(empty.unmatchedRatio, 1);
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
});

test("端到端夹具：短语级 ASS cue × whisper 字级 token → 每个 cue 一个可测起点", () => {
  const cues = parseAssCues(
    `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.05,0:00:01.60,Captions,,0,0,0,,每一块百叶
Dialogue: 0,0:00:01.70,0:00:02.50,Captions,,0,0,0,,都能完全折回
`,
  );
  const report = alignWordStarts(cuesToReferenceUnits(cues), mergeWhisperTokens(ZH_TOKENS));
  assert.equal(report.refUnits, 11);
  assert.equal(report.refTimedUnits, 2);
  assert.equal(report.matchedUnits, 11);
  assert.equal(report.n, 2);
  assert.deepEqual(
    report.pairs.map((pair) => [pair.text, pair.refStartMs, pair.hypStartMs, pair.deltaMs]),
    [["每", 50, 10, 40], ["都", 1700, 1140, 560]],
  );
  assert.equal(report.p95, 560);
  assert.equal(report.passes150ms, false);
});

// ---------------------------------------------------------------------------
// word_by_word 字幕：N 条同句 Dialogue 合回一个 cue，参考文本不重复
// ---------------------------------------------------------------------------

const WORD_BY_WORD_ASS = [
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  // 首词前的空当：整句在场、无高亮
  "Dialogue: 0,0:00:00.00,0:00:00.10,Captions,,0,0,0,,一拧即开，随时补水。",
  "Dialogue: 0,0:00:00.10,0:00:00.60,Captions,,0,0,0,,{\\1c&H0000D7FF&}一拧{\\r}即开，随时补水。",
  "Dialogue: 0,0:00:00.60,0:00:01.10,Captions,,0,0,0,,一拧{\\1c&H0000D7FF&}即开，{\\r}随时补水。",
  "Dialogue: 0,0:00:01.10,0:00:01.50,Captions,,0,0,0,,一拧即开，{\\1c&H0000D7FF&}随时{\\r}补水。",
  "Dialogue: 0,0:00:01.50,0:00:01.80,Captions,,0,0,0,,一拧即开，随时{\\1c&H0000D7FF&}补水。{\\r}",
  // 下一句：普通整句 cue，文本不同，不该被并进去
  "Dialogue: 0,0:00:01.80,0:00:03.00,Captions,,0,0,0,,点击下方链接立即预约。",
].join("\n");

test("word_by_word：同句首尾相接的 Dialogue 合成一个 cue，高亮词还原成逐词起点", () => {
  const cues = parseAssCues(WORD_BY_WORD_ASS);
  assert.equal(cues.length, 2, "5 条同句 Dialogue + 1 条下一句 → 2 个 cue");
  assert.equal(cues[0].text, "一拧即开，随时补水。");
  assert.equal(cues[0].startMs, 0);
  assert.equal(cues[0].endMs, 1800);
  assert.deepEqual(
    cues[0].words?.map((word) => [word.text, word.startMs]),
    [["一拧", 100], ["即开，", 600], ["随时", 1100], ["补水。", 1500]],
    "每条高亮的词按该条 Start 还原；首词前的空当不产生词",
  );
  assert.equal(cues[1].text, "点击下方链接立即预约。");
  assert.equal(cues[1].words, undefined);
});

test("word_by_word：参考单元不再按 Dialogue 条数重复，高亮词的首字带起点", () => {
  const [sentence] = parseAssCues(WORD_BY_WORD_ASS);
  const units = cuesToReferenceUnits([sentence]);
  assert.equal(units.length, splitUnits("一拧即开，随时补水。").length, "整句只出现一次，不按 Dialogue 条数重复");
  const started = units.filter((unit) => unit.startMs !== null).map((unit) => [unit.text, unit.startMs]);
  assert.deepEqual(started, [["一", 100], ["即", 600], ["随", 1100], ["补", 1500]], "只有每个高亮词的首字带起点");
});

test("普通字幕里两条文本相同但不相接的 Dialogue 不会被合并", () => {
  const ass = [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:00.00,0:00:01.00,Captions,,0,0,0,,好用。",
    "Dialogue: 0,0:00:05.00,0:00:06.00,Captions,,0,0,0,,好用。",
  ].join("\n");
  assert.equal(parseAssCues(ass).length, 2);
});
