import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { RealFootageDemoExperience } from "./experience-client";

export const metadata: Metadata = {
  title: "Aivora · 宠物内容智能采集套件 · 投资人 Demo",
  description:
    "Aivora 把真实宠物瞬间变成可分享的可爱视频，也变成给品牌使用的真实产品内容证据。完整演示产品闭环：智能硬件采集 → AI 识别可爱瞬间 → 自动生成视频与宠物日记 → 一键分享裂变 → 宠物社区与品牌真实使用证据。",
};

/**
 * 主对外 demo 页面 —— /showcase。
 *
 * 面向国内投资人 / 宠物品牌的「Aivora 宠物内容智能采集套件」演示，
 * 全中文、暖色卡片风。按产品闭环顺序拼装：
 *
 *   设备 Dashboard → 宠物行为时间线 → AI 识别精彩瞬间 → 主人陪伴模式
 *   → 自动生成视频草稿 → 病毒式分享裂变 → Product Proof Report（B2B）
 *   → 宠物社区生态 → 投资亮点 → 体验申请 CTA。
 *
 * 数据全部从 src/lib/demo/pet-content-kit-demo-data.ts 进来；
 * 修改时只改 data，不改组件结构。CTA 对登录用户指向 /business/create-ad-video，
 * 否则保留 lead form（提交到 /api/demo/real-footage-ads/waitlist）。
 */
export default async function RealFootageAdsDemoPage() {
  const session = await getServerSession(authOptions);
  return <RealFootageDemoExperience isAuthenticated={Boolean(session?.user)} />;
}
