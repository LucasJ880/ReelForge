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
 * CEO 重做后，这里展示的是“客户模拟产品体验页”：
 * 客户输入 → 创意证据卡 → 参考视频 preview → AI 脚本 → AI 分镜 / 拍摄指导 →
 * 素材质检 mock → 最终输出（30s / 15s / 封面 / 多平台 caption） → 宠物美容
 * 行业扩展 → 合规边界。
 *
 * 第一版完全用 sample mock data，不调用 /api/wizard/*；
 * CTA 在登录用户面前直接指向 /wizard/new，否则保留 lead form。
 */
export default async function RealFootageAdsDemoPage() {
  const session = await getServerSession(authOptions);
  return <RealFootageDemoExperience isAuthenticated={Boolean(session?.user)} />;
}
