/**
 * AIVORA_DRY_RUN —— 全局计费保险丝。
 *
 * AIVORA_DRY_RUN=1（或 true/yes/on）时，进程内所有会产生费用的外部调用
 * 必须强制走 mock 或显式拒绝（fail-closed），绝不发出真实计费请求：
 *
 *   【计费】Seedance 视频生成（提交 + 状态查询一并 mock，防止误碰真实任务）
 *   【计费】OpenAI LLM / vision（chatJson 系列）
 *   【计费】火山 Ark LLM / vision
 *   【计费】OpenAI 图像生成
 *   【计费】火山 TTS 语音合成（无 mock 输出 → 显式抛错拒绝）
 *   【计费】OmniHuman 数字人（无 mock 输出 → 显式抛错拒绝）
 *   【计费】Apify TikTok 抓取（付费 actor → 视为不可用）
 *
 * 免费路径（dry-run 下不受影响）：ffmpeg、Prisma/Neon 读写、
 * Vercel Blob / TOS 上传、下载已付费的段 URL、缩略图生成。
 *
 * 各 provider 在自己的 mock 判定里调用 isDryRun()；新增计费 provider 时
 * 必须同样接入，这是硬性约定。
 */
export function isDryRun(): boolean {
  const v = process.env.AIVORA_DRY_RUN?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * 统一的拒绝错误：给没有 mock 实现的计费 provider 用。
 * 消息里带 provider 名，方便在任务级错误里定位是哪条计费路径被拦截。
 */
export function dryRunRefusalError(provider: string): Error {
  return new Error(
    `[AIVORA_DRY_RUN] 拒绝调用计费服务 "${provider}"：dry-run 模式下所有计费调用被强制拦截。`,
  );
}
