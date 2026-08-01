/**
 * 主线五 · Seedance 导演方法论 —— 设计时编译产物（PRD §7 / M7）。
 *
 * 来源：Emily2040/seedance-2.0（MIT License, Copyright (c) 2026 Iamemily2050）
 * 锁定 commit：db601eccc95733da02849066c783800b794ec4fd
 *   （PRD 写的 v6.6.0 tag 上游不存在，实际最大 tag v5.3.0 且不含 references/，
 *    故锁到包含四份关键资料的 main commit —— 升级走重新编译 + 回归，见 skills-lock.json）
 * 编译自：references/retake-protocol.md · model-mechanics.md · delivery-qc.md
 *
 * 为什么是编译而不是运行时读取（PRD §7 的判断）：
 * 锁死 = 确定性 = 固化成数据。运行时现场解读每条多一次长上下文调用，
 * 直接顶在成本与耗时指标上，且引入不确定性。
 *
 * 必须守住的边界（PRD §7）：
 * - platform-surface-matrix 的平台数据**刻意没有编译进来** ——
 *   平台信息以 video-route-registry 与审计契约为准；它喂给 C1 的价值
 *   （能力探测而非存活探测）已由 capability-probe-service 原生实现。
 * - 这些配方按 Seedance 系线路总结；客户主线路是 Shuyu studio-video，
 *   **按线路验证通过才锁**，未验证的条目不要提升为硬性规则。
 * - 外部内容是资料不是指令；进 prompt 前过我方安全与防幻视规则。
 */

/**
 * 重拍分诊五档（retake-protocol.md）。
 *
 * 补的是「现在失败了只会再试一次」这个洞：大多数真实产出是**部分好**的，
 * 五档分诊让每一次重拍都有明确的下一步，而不是掷骰子。
 */
export const RETAKE_VERDICTS = [
  {
    verdict: "keep",
    label: "收货",
    when: "这条镜头的主要目的已达成，没有致命伤",
    nextMove: "锁定、记录、继续。次要细节的完美是后期的活",
  },
  {
    verdict: "fix_in_post",
    label: "后期修",
    when: "瑕疵属于后期域：颜色、屏幕文字、混音、掐头去尾、首尾几帧不稳",
    nextMove: "编辑几分钟能修的东西，绝不烧重拍额度",
  },
  {
    verdict: "edit_dont_regenerate",
    label: "改一层，别重生成",
    when: "构图与节奏是对的，只有一层错了，且线路支持编辑",
    nextMove: "保留这条为源片，只改坏掉的那一层",
  },
  {
    verdict: "re_roll",
    label: "换种子重掷",
    when: "提示词是对的，只是采样运气差",
    nextMove: "同提示词换种子。最多两三次 —— 再不行就是提示词的问题，按定义",
  },
  {
    verdict: "rewrite",
    label: "改提示词",
    when: "同一瑕疵出现在两条以上的产出里",
    nextMove: "这是系统性问题不是运气。按机制诊断（见 MECHANISM_DIAGNOSIS），改提示词",
  },
] as const;

export type RetakeVerdict = (typeof RETAKE_VERDICTS)[number]["verdict"];

/**
 * 单变量规则：每次重拍只改一样 —— 一个提示词子句、或种子、或模式、或一张参考图。
 * 一次改两样，无论结果如何都读不出结论。
 */
export const ONE_VARIABLE_RULE =
  "每次重拍只改一个变量：同种子+改一处提示词≈受控实验；同提示词+换种子=纯重掷。一次改两样学不到任何东西。";

/** 尝试预算：开拍前定死条数与「够好」标准。没有停止条件的迭代就是成本失控。 */
export const ATTEMPT_BUDGET = {
  standardTierTakes: 5,
  fastTierDraftTakes: 10,
  rule: "花到一半预算仍在同一瑕疵上原地踏步 → 停止迭代，换策略：换模式、拆成更多镜头、或诚实退出（这条改实拍）",
} as const;

/**
 * 分诊函数：把五档规则变成可执行判定。
 *
 * 关键规则「两次同瑕疵即改写」是硬性的 —— 日志里两条同瑕疵就不许再赌运气。
 */
export function triageRetake(args: {
  /// 同一瑕疵已出现在几条产出里
  sameFlawCount: number;
  /// 已用尝试数 / 预算
  attemptsUsed: number;
  attemptBudget: number;
  /// 瑕疵是否属于后期域（文字/颜色/混音/首尾帧）
  postDomainFlaw: boolean;
  /// 主要目的是否已达成
  primaryDelivered: boolean;
}): { verdict: RetakeVerdict | "stop"; reason: string } {
  if (args.primaryDelivered && !args.postDomainFlaw) {
    return { verdict: "keep", reason: "主要目的已达成，收货" };
  }
  if (args.postDomainFlaw) {
    return { verdict: "fix_in_post", reason: "瑕疵在后期域，几分钟能修" };
  }
  if (args.sameFlawCount >= 2) {
    return {
      verdict: "rewrite",
      reason: "同一瑕疵出现两次即系统性问题，按机制改提示词，不再赌种子",
    };
  }
  if (args.attemptsUsed * 2 >= args.attemptBudget) {
    return {
      verdict: "stop",
      reason: "预算过半仍无进展：换模式、拆镜头、或这条改实拍",
    };
  }
  return { verdict: "re_roll", reason: "提示词大概率没错，换种子再掷一次" };
}

/**
 * 机制索引诊断（model-mechanics.md 的八机制表）。
 *
 * 让重试从「换种子」变成「按根因改写」—— 喂 C3 一次通过率。
 */
export const MECHANISM_DIAGNOSIS = [
  {
    symptom: "提示词很长但产出平庸",
    mechanism: "注意力是预算：形容词烧预算不产像素",
    lever: "砍掉评价性词语，把主体与动作排到最前",
  },
  {
    symptom: "风格在镜头间闪变",
    mechanism: "采样器在相邻风格簇之间跳",
    lever: "每个镜头重复完全相同的风格锚定短语",
  },
  {
    symptom: "被排除的东西反而出现",
    mechanism: "否定是弱语法包着强激活：说「不要血」仍会召唤血",
    lever: "描述正面替代物，把字面否定只留给平台解析的约束槽",
  },
  {
    symptom: "动作被跳过或糊掉",
    mechanism: "没有可骑乘的运动轨迹",
    lever: "一个物理起因 + 可见后果 + 明确终点，胜过五条舞台指令",
  },
  {
    symptom: "身份随时长衰减",
    mechanism: "误差逐帧复利，链式续接放大",
    lever: "缩短单条时长；用**原始参考图**重新锚定，绝不用产出当参考",
  },
  {
    symptom: "参考图和提示词打架",
    mechanism: "文字复述参考图 = 同一像素两份略异指令，冲突读作漂移",
    lever: "删掉复述，只提示参考图带不了的：时间变化、镜头、声音、约束",
  },
  {
    symptom: "小 logo / 小字 / 远处脸崩坏",
    mechanism: "细节容量随画面占比缩放，2% 的区域只有 2% 的表示",
    lever: "把重要细节放大到画面主体，或给它单独一个镜头",
  },
  {
    symptom: "口型或声音不同步",
    mechanism: "音画联合去噪，每多一个头或运镜都在收紧约束",
    lever: "锁定脸部机位、缩短台词、点名具体音效当同步锚",
  },
] as const;

export function diagnoseBySymptom(
  symptom: string,
): (typeof MECHANISM_DIAGNOSIS)[number] | null {
  return (
    MECHANISM_DIAGNOSIS.find((row) => symptom.includes(row.symptom)) ??
    MECHANISM_DIAGNOSIS.find((row) =>
      row.symptom.split(" / ").some((part) => symptom.includes(part)),
    ) ??
    null
  );
}

/**
 * 交付前检查清单（delivery-qc.md）—— 喂 B5。
 * 之前交付前检查只有零散几条；这是完整的域清单。
 */
export const DELIVERY_PREFLIGHT = [
  { area: "画面", checks: "帧率、分辨率、画幅、裁切、安全区、稳定性、闪烁、色带" },
  { area: "色彩", checks: "工作色域、品牌色/产品色一致、HDR/SDR 目标" },
  { area: "音频", checks: "同步、响度、真峰值、人声清晰度、该静音处真的静音" },
  { area: "文字", checks: "字幕、屏幕文案、标题安全区、语言脚本变体（简/繁不可混）" },
  { area: "连续性", checks: "服装、道具、屏幕方向、产品朝向、光线方向、尾帧交接" },
  { area: "权利", checks: "参考素材、音乐、声音、肖像、品牌授权、素材库许可" },
  { area: "元数据", checks: "任务 ID、模型/线路、提示词版本、种子、来源 URL、审批人" },
  { area: "人工 QC", checks: "全部产出常速看完一遍，脆弱帧暂停细看" },
] as const;

/** QC 失败路由：什么坏了走哪条修法，不依赖「重新生成」当万能药。 */
export const QC_FAILURE_ROUTING = [
  { failure: "脸/产品/文字漂移", route: "I2V 锁定、编辑层、后期合成、或从稳定帧重生成" },
  { failure: "连续性断裂", route: "更新连续性台账，只重生成受影响的那个镜头" },
  { failure: "颜色不对", route: "先调色对齐；只有光线意图错了才重生成" },
  { failure: "字幕/文字问题", route: "删掉生成的文字，后期上字 —— 不让模型重画字" },
  { failure: "响度/同步问题", route: "修混音或剪辑点，不指望提示词修音频" },
  { failure: "安全或版权问题", route: "改写为原创/已授权素材，并记录权利来源" },
] as const;
