import type { Metadata } from "next";
import { Archivo, Martian_Mono, Noto_Sans_SC } from "next/font/google";
import { getServerSession } from "next-auth";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/providers/session-provider";
import { SessionExpiryWatcher } from "@/components/providers/session-expiry-watcher";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getServerLocale } from "@/i18n/server";
import { authOptions } from "@/lib/auth";
import "./globals.css";

// 拉丁显示与界面：Archivo 可变字宽（wdth 62–125），大而轻的标题与读数用宽体。
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

// 中文：标题与正文同一声音，不落回系统默认；next/font 按 unicode-range 分片按需下载。
const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  subsets: ["latin"],
  display: "swap",
});

// 一切代码、时间、计数：Martian Mono，表格用窄字宽，行情带用宽字宽。
const martianMono = Martian_Mono({
  variable: "--font-martian-mono",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aivora — AI Growth Exchange",
  description:
    "AI-powered short-form video creation: project setup, brand assets, AI direction, multi-segment video generation, preview and publish.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [session, locale] = await Promise.all([
    getServerSession(authOptions),
    getServerLocale(),
  ]);

  return (
    <html
      lang={locale}
      className={`${archivo.variable} ${notoSansSC.variable} ${martianMono.variable} h-full`}
    >
      <body className="h-full antialiased">
        <span
          hidden
          data-design-contract="aivora-abyss-exchange"
          dangerouslySetInnerHTML={{
            __html: [
              "<!--",
              "THESIS: 小商家的出片与获客是一面交易所行情墙：批次是在成交的委托，成片是持仓，赢家是该加仓的标的，Agent 的动作滚动在成交带上；拒绝暖石墨+品牌橙+毛玻璃的旧工作台与白底卡片格 SaaS。",
              "OWN-WORLD: 冷蓝近黑交易大厅 + 极淡 56px 工程网格；不透明 hull 面板以 1px 冷蓝接缝拼墙；颜色只来自数据与媒体——信号青（实时/当前/主行动）、成交绿、赢家金、失败玫红、AI 鸢尾紫；Archivo 大而轻的标题与读数 + Noto Sans SC；Martian Mono 承载代码、时间与计数；圆角 3/6/10；光只在边缘与生成中的那一格。",
              "STORY: 打开就看见自己的生产线在成交——什么在生成、什么已成交、什么失败已退款、哪条在赢——下一笔该下什么单一目了然。",
              "FIRST VIEWPORT: 顶部行情条（▲品牌、工作区代码、搜索、市场状态、账户）+ 实时成交带；左侧编号终端导轨；页面以行情头开场：大而轻的标题 + 大号读数，主行动是右侧信号青实心钮。",
              "FORM: 用户钦定（交易所 + 大屏，2026-10-24），seed key: aivora-abyss-exchange；未跑 concept-seed（brief-pinned direction beats the roll）。",
              "FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md",
              "-->",
            ].join("\n"),
          }}
        />
        <AuthProvider session={session}>
          <I18nProvider initialLocale={locale}>
            <SessionExpiryWatcher />
            {children}
            <Toaster richColors position="top-right" />
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
