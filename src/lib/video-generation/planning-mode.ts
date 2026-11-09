/**
 * 出方案精简（2026-11-09）。
 *
 * 体检时把一条片从点「生成故事板」到提交给视频模型的模型调用数了一遍——最多 11 次，分三处各跑一轮：
 *
 *   口播稿起草 ×1 → 出方案（/plan）×4 → 建故事板 ×2（镜头卡、原话英译）→ 生成视频（/dispatch）时再出一遍方案 ×4
 *
 * 出方案那 4 次是「创意简报 ‖ 看商品图 → 一致性设定 → 段提示词」，后两步串行，一轮 40–60 秒，而且跑两轮。
 * 但单条视频必须先有已确认的故事板（dispatch 强制要 storyboardRunId），派发时提示词会按故事板改写
 *（storyboard-beats 的三个 ground* 函数）：剧情与镜头来自商家原话 + 镜头卡，方案里的段提示词只留下
 * PRODUCT / 主播 CHARACTER / 各类 LOCK / Audio / Spoken dialogue 这几行模板行（KEEP_TEMPLATE_LINE）。于是：
 *
 *  - 「段提示词」那次调用写的镜头表**整段被丢弃**，只有它顺手写的一句负面提示词会进成片提示词；
 *  - 「一致性设定」那次调用写的人物、场景、光线、画风**全被丢弃**，只剩商品描述一句进 PRODUCT 行——
 *    而它没看图，是把「看商品图」那一步的描述再转述一遍；
 *  - 这两步都在串行位上，失败各有兜底，各自是一个出错点。
 *
 * 精简后这两步直接走各自现成的确定性版本（heuristicBible / heuristicSegmentPrompts），不再调模型：
 * 出方案一轮从 4 次、3 个串行阶段变成 2 次、并行 1 个阶段。创意简报（方案卡给商家看的开场与卖点）和
 * 看商品图（PRODUCT 行的商品描述）照旧。
 *
 * 进成片提示词的内容因此只变四处，都已核对过代码路径：
 *   1. PRODUCT 行的商品描述直接用看图那一步的原话，不再经没看图的模型转述；
 *   2. 负面提示词用固定的 DEFAULT_NEGATIVE_PROMPT，不再是模型每次自由发挥的一句；
 *   3. 带主播照时 CHARACTER 行里的人物描述用通用设定（原先那段也是没看照片编的，身份本来就由照片锁定）；
 *   4. 商家关了口播时，Audio 行固定写「只有环境声、不要旁白」。旧路径里模型若自己给镜头写了台词，
 *      Audio 行会变成「念出引用的台词」，而台词行在改写时已被丢掉——模型可能因此自己编旁白。
 *      精简的模板镜头表不带台词（heuristicSegmentPrompts 的 silentShots），所以不会出现这种情况。
 *      开着口播时两条路径一样：都走已确认口播稿那一支。
 *
 * 这次改动没有经过真机出片对照（真机要花积分、由人确认）。所以留一个不用回滚代码的退路：
 * 环境变量 PLANNING_FULL_LLM=on 一键退回四次调用的旧路径（与 SHUYU_OPENING_FRAME_PROMPT=off 同一个做法）。
 *
 * 还没做的（下一步，需要给故事板加一列存结果）：把镜头卡、原话英译、看商品图并成建故事板时的一次看图调用，
 * 派发时直接复用，不再第二次出方案——那才是真正的「一次调用」。
 */

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** 精简出方案是否生效：缺省开；PLANNING_FULL_LLM=on / true / 1 / yes 退回旧的四次调用。 */
export function leanPlanningEnabled(env: EnvLike = process.env): boolean {
  const full = env.PLANNING_FULL_LLM?.trim().toLowerCase();
  return !(full === "on" || full === "true" || full === "1" || full === "yes");
}
