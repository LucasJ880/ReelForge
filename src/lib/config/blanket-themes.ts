/**
 * 真实素材广告的"探索型 angle"主题池。
 *
 * 赛马规则：每轮 5 条 = 3 优化型 + 2 探索型。
 * 探索型必须从本池中抽取，避免创意塌缩。
 */

export interface ExplorationTheme {
  key: string;
  label: string;
  description: string;
  /** LLM 生成 angle 时的提示 */
  prompt: string;
}

export const BLANKET_THEME_POOL: ExplorationTheme[] = [
  {
    key: "proof_closeup",
    label: "真实细节特写",
    description: "极近距离捕捉产品材质、质感、功能细节或服务过程证据",
    prompt:
      "从客户真实素材中挑选最有说服力的产品/服务细节特写，用快速字幕指出一个具体证据点，避免空泛形容。",
  },
  {
    key: "before_after",
    label: "Before / After",
    description: "用真实对比镜头展示使用前后、服务前后或问题解决前后",
    prompt:
      "把真实素材剪成 before/after 对比：先展示痛点或未使用状态，再展示改善结果，用同屏或快速转场强化差异。",
  },
  {
    key: "ugc_review",
    label: "UGC 测评",
    description: "真人或拟真人口吻的真实测评，强调第一人称体验",
    prompt:
      "以 UGC 测评结构组织真实镜头：我为什么买/试、最意外的一点、真实使用画面、是否推荐。口吻自然，不像硬广。",
  },
  {
    key: "problem_solution",
    label: "痛点解决",
    description: "先放大用户痛点，再用真实素材证明解决方案",
    prompt:
      "前三秒直接点出目标用户的具体痛点，中段用真实素材展示产品/服务如何解决，结尾给出低门槛 CTA。",
  },
  {
    key: "emotional_moment",
    label: "情绪价值",
    description: "从宠物反应、顾客表情、家庭场景或门店氛围中提炼情绪价值",
    prompt:
      "选择真实素材里最有情绪感染力的瞬间，例如宠物反应、顾客满意表情、家庭使用场景或门店服务细节，做轻广告化表达。",
  },
  {
    key: "pattern_interrupt",
    label: "反差 Hook",
    description: "用出乎意料、搞笑或反差镜头打断滑动，提升前三秒停留",
    prompt:
      "从真实素材中挑选最反常、搞笑、可爱或意外的镜头作为开头，随后迅速连接到产品/服务卖点。",
  },
];

export function getThemeByKey(key: string): ExplorationTheme | undefined {
  return BLANKET_THEME_POOL.find((t) => t.key === key);
}

/**
 * 为一个新轮次选 N 个探索主题（默认 2）。
 * 策略：优先选未被本交付单使用过的主题，保证每轮探索多样化。
 */
export function pickExplorationThemes(
  usedKeys: string[],
  count: number,
): ExplorationTheme[] {
  const unused = BLANKET_THEME_POOL.filter((t) => !usedKeys.includes(t.key));
  const pool = unused.length >= count ? unused : BLANKET_THEME_POOL;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
