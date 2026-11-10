import assert from "node:assert/strict";
import test from "node:test";
import {
  alignCuesToSpeech,
  planCaptionCues,
  type SpokenWord,
} from "../src/lib/video-generation/audio-post-production";

/**
 * 2026-11-10：商家反馈「人声已经讲完了，字幕还没更新」。字幕原来把口播稿按字数摊满整段，
 * 而模型常在 7–10 秒内就把两句话说完。这里守住「拿到语音识别的时间之后，字幕跟着人声走」。
 *
 * 下面三份逐字时间是 2026-11-09 三条真实成片的本机 whisper.cpp（ggml-small）识别结果，原样保留：
 * 识别写错的字（抿→米、耐→奈、玩→碗）、繁体（綿繩節還著）都在里面——对齐逻辑必须扛得住。
 */
const words = (rows: ReadonlyArray<readonly [string, number, number]>): SpokenWord[] =>
  rows.map(([text, startMs, endMs]) => ({ text, startMs, endMs }));

/// 唇釉：两句话 7.3 秒说完，原字幕第二句 8.4 秒才出现
const LIP = {
  script: "三个颜色，通勤、约会、周末都够用。今天选珊瑚，抿一下就出门。",
  durationSec: 14.5,
  words: words([["三",230,250],["个",250,500],["颜",500,680],["色",780,920],["通",1300,1450],["勤",1490,1730],["约",2050,2180],["会",2180,2450],["周",2780,2920],["末",2920,3160],["都",3330,3430],["够",3480,3740],["用",3740,3830],["今",4330,4535],["天",4535,4740],["选",4740,5020],["珊",5260,5360],["瑚",5400,5700],["米",5860,5920],["一",6150,6360],["下",6360,6570],["就",6820,6820],["出",6890,7060],["门",7060,7270]]),
};
/// 狗玩具：识别出繁体和错字，只对得上 65%
const TOY = {
  script: "耐咬的棉绳结，拔河、磨牙都靠它。玩累了还抱着睡。",
  durationSec: 15,
  words: words([["奈",10,650],["咬",750,1320],["的",1320,1690],["綿",2100,2640],["繩",2640,3300],["節",3300,4000],["拔",4320,4800],["河",4800,5280],["磨",5710,6080],["牙",6080,6560],["都",6560,7040],["靠",7040,7520],["它",7520,7960],["碗",8180,8420],["累",8420,8680],["了",8680,8940],["還",8940,9200],["抱",9200,9460],["著",9460,9610],["睡",9710,10000]]),
};
/// 咖啡：两句之间停了 4 秒多
const COFFEE = {
  script: "撕开袋子就是香的。现磨现冲，一口就喝得出来。",
  durationSec: 14.667,
  words: words([["撕",10,450],["开",450,900],["袋",900,1350],["子",1350,1800],["就",1980,2330],["是",2330,2680],["香",2830,3150],["的",3150,3530],["现",8000,8000],["磨",8000,8000],["现",8000,8000],["冲",8010,9000],["一",9170,9420],["口",9420,9690],["就",9950,9950],["喝",9980,10210],["得",10210,10470],["出",10470,10735],["来",10735,11000]]),
};

const plan = (sample: typeof LIP, speechWords?: SpokenWord[] | null) =>
  planCaptionCues({
    script: sample.script,
    segments: [{ durationSec: sample.durationSec, captioned: true }],
    captionSpanSec: sample.durationSec,
    speechWords,
  });

test("没有识别结果：字幕时间和以前一模一样（按字数摊满整段）", () => {
  const before = plan(LIP);
  assert.notEqual(before.source, "speech");
  assert.equal(before.cues.length, 2);
  /// 这就是商家看到的毛病：第二句 8.4 秒才出现，而人声 4.3 秒就开始说第二句了
  assert.equal(before.cues[1].startMs, 8401);
  assert.equal(before.cues[1].endMs, 14500);
  assert.deepEqual(plan(LIP, []).cues, before.cues);
  assert.deepEqual(plan(LIP, null).cues, before.cues);
});

test("有识别结果：每句字幕跟着它被说出来的时间走，字以口播稿为准", () => {
  const after = plan(LIP, LIP.words);
  assert.equal(after.source, "speech");
  assert.deepEqual(after.cues.map((cue) => cue.text), ["三个颜色，通勤、约会、周末都够用。", "今天选珊瑚，抿一下就出门。"]);
  const [first, second] = after.cues;
  /// 第一句人声 0.23 秒开口：字幕略早一点出现
  assert.ok(first.startMs >= 0 && first.startMs <= 230, `first.startMs=${first.startMs}`);
  /// 第二句人声 4.33 秒开口：字幕在它之前 0–0.2 秒换上去，不再等到 8.4 秒
  assert.ok(second.startMs <= 4330 && second.startMs >= 4130, `second.startMs=${second.startMs}`);
  /// 两句只隔 0.5 秒：上一句直接接到下一句，中间不闪
  assert.equal(first.endMs, second.startMs);
  /// 最后一句 7.27 秒说完：多留半秒就收掉，不拖到片尾
  assert.ok(second.endMs >= 7270 && second.endMs <= 7270 + 600, `second.endMs=${second.endMs}`);
  /// 「抿」被识别成「米」：字幕里仍然是口播稿的字
  assert.match(second.text, /抿/);
});

test("识别有繁体和错字：对得上一半以上就照样对齐", () => {
  const aligned = alignCuesToSpeech(TOY.script, TOY.words, { spanMs: TOY.durationSec * 1000 });
  assert.ok(aligned);
  assert.ok(aligned.coverage >= 0.6 && aligned.coverage < 0.75, `coverage=${aligned.coverage}`);
  const [first, second] = aligned.cues;
  assert.equal(second.text, "玩累了还抱着睡。");
  /// 第二句的头一个字「玩」被识别成「碗」，对不上：按这一句的语速往前推，落在 8.18 秒附近
  assert.ok(Math.abs(second.startMs - 8180) <= 350, `second.startMs=${second.startMs}`);
  assert.ok(first.startMs <= 100);
  assert.ok(second.endMs <= TOY.durationSec * 1000);
});

test("两句之间停得久：上一句说完就收，下一句等人声开口才出现", () => {
  const after = plan(COFFEE, COFFEE.words);
  assert.equal(after.source, "speech");
  const [first, second] = after.cues;
  /// 第一句 3.53 秒说完，字幕多留半秒
  assert.ok(first.endMs >= 3530 && first.endMs <= 4100, `first.endMs=${first.endMs}`);
  /// 第二句 8.0 秒才开口：原来 5.97 秒就换上去（早了 2 秒），现在等到开口
  assert.ok(second.startMs >= 7800 && second.startMs <= 8000, `second.startMs=${second.startMs}`);
  assert.ok(second.startMs - first.endMs > 3000, "中间这段没人说话，不挂字幕");
});

test("对不上口播稿（说的不是这份稿 / 识别是乱的）：放弃对齐，退回按字数摊", () => {
  const noise = words([["今",100,300],["天",300,500],["天",500,700],["气",700,900],["不",900,1100],["错",1100,1300]]);
  assert.equal(alignCuesToSpeech(LIP.script, noise, { spanMs: 14500 }), null);
  const fallback = plan(LIP, noise);
  assert.notEqual(fallback.source, "speech");
  assert.deepEqual(fallback.cues, plan(LIP).cues);
  assert.equal(alignCuesToSpeech("", LIP.words, { spanMs: 14500 }), null);
  assert.equal(alignCuesToSpeech(LIP.script, LIP.words, { spanMs: 0 }), null);
});

test("中间一句一个字都没识别出来：夹在前后两句之间，不丢、不越界", () => {
  const script = "第一句说完了。当中这句没听清。最后一句收尾。";
  const heard = words([
    ["第",0,200],["一",200,400],["句",400,600],["说",600,800],["完",800,1000],["了",1000,1200],
    ["最",5000,5200],["后",5200,5400],["一",5400,5600],["句",5600,5800],["收",5800,6000],["尾",6000,6200],
  ]);
  const aligned = alignCuesToSpeech(script, heard, { spanMs: 10_000 });
  assert.ok(aligned);
  assert.equal(aligned.cues.length, 3);
  const [first, middle, last] = aligned.cues;
  assert.equal(middle.text, "当中这句没听清。");
  assert.ok(middle.startMs >= first.startMs && middle.startMs >= 1000 && middle.endMs <= last.startMs);
  assert.ok(Math.abs(last.startMs - 5000) <= 150);
});

test("英文按词对齐；时间永远不倒退、不重叠、不出片尾", () => {
  const script = "Hot coffee all morning. Fits in one hand.";
  const heard = words([
    ["Hot",300,550],["coffee",550,950],["all",950,1150],["morning",1150,1700],
    ["fits",2600,2900],["in",2900,3000],["one",3000,3250],["hand",3250,3700],
  ]);
  const aligned = alignCuesToSpeech(script, heard, { spanMs: 5000 });
  assert.ok(aligned);
  assert.equal(aligned.coverage, 1);
  assert.deepEqual(aligned.cues.map((cue) => cue.text), ["Hot coffee all morning.", "Fits in one hand."]);
  assert.ok(Math.abs(aligned.cues[1].startMs - 2600) <= 150);
  for (const sample of [LIP, TOY, COFFEE]) {
    const cues = plan(sample, sample.words).cues;
    cues.forEach((cue, index) => {
      assert.ok(cue.startMs >= 0 && cue.endMs > cue.startMs, `cue ${index} 有正的时长`);
      assert.ok(cue.endMs <= Math.round(sample.durationSec * 1000), `cue ${index} 不出片尾`);
      if (index > 0) assert.ok(cue.startMs >= cues[index - 1].endMs, `cue ${index} 不和上一句重叠`);
    });
  }
  /// 识别结果里超出字幕窗口的词不算数
  const clipped = alignCuesToSpeech(script, heard, { spanMs: 1000 });
  assert.equal(clipped, null, "窗口里只听到 8 个词里的 3 个，对上的不到一半 → 放弃");
});
