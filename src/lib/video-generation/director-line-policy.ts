/**
 * 线上创作台走不走「导演线路」的判断，和给界面看的脚本摘要的形状（2026-11-17，线上对齐第 2 步）。
 *
 * 这个文件不引任何服务端模块：创作页（'use client'）要用同一条判断来决定要不要先等「出方案」那一步。
 * 真正写脚本、存脚本、拼提示词的代码在 director-line.ts（服务端）。
 *
 * 导演线路 = 一份镜头脚本 → 一张开场帧 → 一次生成整条片（15 / 30 秒都是一次），和 Claude 这边的
 * `npm run director` 用的是同一套规则与同一个提示词拼法（director-plan.ts）。
 */

/** 模板库里的「电商快销」：选它就把片种定成快销；「自动匹配」则由导演写手按商品自己定片种。 */
export const DIRECTOR_LINE_TEMPLATE_ID = "tpl_ecommerce_fmcg";

/** 导演线路做得了的时长：都是一次生成（60 秒还是老的分段拼接）。 */
export const DIRECTOR_LINE_DURATIONS: readonly number[] = [15, 30];

/** 总开关：缺省开，`DIRECTOR_LINE=off` 退回老的四帧故事板 + 分段出片。 */
export function directorLineEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.DIRECTOR_LINE ?? "").trim().toLowerCase() !== "off";
}

export interface DirectorLineApplicability {
  enabled: boolean;
  durationSec: number;
  /// 商家实拍图张数：没有实拍图不凭空画商品，走老路
  productImageCount: number;
  /// 主播参考图：导演线路默认不把真人照片带给出片模型，传了就走老路
  personImageCount?: number;
  /// null / undefined = 「自动匹配」
  styleTemplateId?: string | null;
  /// StoryboardRun.purpose；批量的故事板不走这条
  purpose?: string | null;
}

export function directorLineApplies(input: DirectorLineApplicability): boolean {
  if (!input.enabled) return false;
  if ((input.purpose ?? "").startsWith("batch-")) return false;
  if (!DIRECTOR_LINE_DURATIONS.includes(input.durationSec)) return false;
  if (input.productImageCount < 1) return false;
  if ((input.personImageCount ?? 0) > 0) return false;
  const template = input.styleTemplateId?.trim() || null;
  return template === null || template === DIRECTOR_LINE_TEMPLATE_ID;
}

/** 给故事板面板看的脚本摘要：一句话梗概、场景卡、每个镜头做什么、哪句台词在哪个镜头。 */
export interface DirectorScriptView {
  logline: string;
  genre: "fmcg" | "lifestyle";
  productType: string;
  scenario: {
    who: string;
    where: string;
    moment: string;
    trouble: string;
    after: string;
    emotion: string;
  } | null;
  shots: Array<{
    index: number;
    fromSec: number;
    toSec: number;
    /// 写给出片模型的画面描述（英文原文）
    action: string;
    /// 给商家看的一句话：这一镜拍什么（商家的语言）。旧脚本没有 = null，界面退回显示英文原文
    note: string | null;
    /// 这个镜头里念的台词；没有台词是 null
    line: string | null;
  }>;
}
