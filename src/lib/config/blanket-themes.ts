/**
 * 毛毯类目的"探索型 angle"主题池。
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
    key: "asmr_texture",
    label: "ASMR 触感特写",
    description: "极近距离捕捉毛毯绒毛/面料的触感与质感",
    prompt:
      "超近景 ASMR 风格，手指缓慢划过毛毯表面，灯光柔和，背景音乐以布料摩擦的 ASMR 声为主，让观众感受到触觉的柔软温暖。",
  },
  {
    key: "room_makeover",
    label: "房间焕新",
    description: "一秒房间改造：一条毛毯改变卧室/沙发氛围",
    prompt:
      "before/after 房间改造对比：裸床/旧沙发 → 毛毯铺上后 → 整体审美升级。过渡用快速 whip cut。",
  },
  {
    key: "movie_night",
    label: "追剧场景",
    description: "追剧、电影夜、窝在沙发里的温馨场景",
    prompt:
      "暗调客厅，电视屏光映在人身上，盖着毛毯窝在沙发里，手里有爆米花。强调情绪与慢节奏的放松感。",
  },
  {
    key: "winter_essential",
    label: "冬季刚需",
    description: "冬季必备，强调温暖与实用性",
    prompt:
      "室外冷色调 vs 室内暖色调的强对比，突出毛毯作为冬季必需品的抵御寒冷功能。",
  },
  {
    key: "giftable",
    label: "礼物推荐",
    description: "作为情人节/圣诞/生日礼物的场景",
    prompt:
      "节日氛围布置（圣诞树/情人节红色），礼盒打开瞬间展示毛毯，收礼人表情惊喜。适合节日营销节点。",
  },
  {
    key: "pet_steal",
    label: "宠物抢毛毯",
    description: "猫狗抢毛毯的搞笑场景，天然高互动",
    prompt:
      "主人刚铺好毛毯，宠物（猫/狗）立刻抢占躺上去。人物表情 = 无奈 + 宠溺。高 relatable 高互动。",
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
