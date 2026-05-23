import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { RealFootageDemoExperience } from "./experience-client";

export const metadata: Metadata = {
  title: "Aivora · 投资人版本案例展示",
  description:
    "用两个真实北美客户案例完整演示 Aivora 的 AI 视频工作流：Sunny Shutter（加拿大电动智能卷帘 · 投资级品牌叙事）+ Mapleside Living（多伦多本地家居织物 · 批量化零售样片）。两个案例都可直接播放成片。",
};

/**
 * 主对外 demo 页面 —— /showcase（旧路径 /demo/real-footage-ads 兼容保留）。
 *
 * 当前版本面向投资人 / 政府孵化器，采用双客户案例并列叙事：
 *
 *   案例 A · Sunny Shutter（加拿大电动智能卷帘品牌 · 投资级叙事）
 *     —— 走完整 7 步工作流：客户输入 → 创意方向 → 参考结构 →
 *        AI 脚本 → 分镜 → 素材质检 → 最终成片。最终输出位接入真实
 *        生成的 30 秒投资人版本成片（V2.1 image-storyboard-guided I2V）。
 *
 *   案例 B · Mapleside Living（多伦多本地家居织物品牌 · 批量化零售）
 *     —— 证明同一套工作流也能服务本地零售商家，使用已生成的本地家居
 *        毛毯样片（30 秒竖屏）作为真实可播放证据。
 *
 *   投资亮点专区 —— 把页面叙事拉高到「这是一家可投的小型公司」：
 *     4 关键指标、4 个核心支柱、4 阶段 roadmap、创始人介绍 + CTA。
 *
 * 数据全部从 src/lib/demo/ai-video-workflow-demo-data.ts 进来；
 * 修改时只改 data，不改组件结构。CTA 对登录用户指向 /business/create-ad-video，
 * 否则保留 lead form（提交到 /api/demo/real-footage-ads/waitlist）。
 */
export default async function RealFootageAdsDemoPage() {
  const session = await getServerSession(authOptions);
  return <RealFootageDemoExperience isAuthenticated={Boolean(session?.user)} />;
}
