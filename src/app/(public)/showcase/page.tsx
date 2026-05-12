import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { RealFootageDemoExperience } from "./experience-client";

export const metadata: Metadata = {
  title: "Aivora · AI 视频工作流体验",
  description:
    "完整体验一遍 Aivora 的生产工作流：客户输入 → 数据支撑的创意方向 → AI 脚本 → 分镜与拍摄指导 → 素材质检 → 最终成片。页面数据均为示例（sample data），不代表任何真实客户。",
};

/**
 * 主对外 demo 页面 —— /demo/real-footage-ads。
 *
 * 页面叙事分两个清晰的案例层级：
 *   案例 A · 房地产 / North York condo —— 主 workflow 示例，
 *           展示客户输入 → 创意证据卡 → 参考结构 → AI 脚本 → 分镜 →
 *           素材质检；最终输出位为 placeholder，房地产成片做好后接入。
 *   案例 B · 本地家居用品 / 毛毯商家 —— 真实商家概念样片，
 *           用当前已接入的 mainConceptVideo 证明同一套工作流也能
 *           扩展到本地零售 / 产品类商家。
 *
 * 第一版完全用 sample mock data，不调用任何生成 API；
 * CTA 在登录用户面前直接指向 /business/create-ad-video，否则保留 lead form。
 */
export default async function RealFootageAdsDemoPage() {
  const session = await getServerSession(authOptions);
  return <RealFootageDemoExperience isAuthenticated={Boolean(session?.user)} />;
}
