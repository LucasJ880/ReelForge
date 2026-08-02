import type { Metadata } from "next";
import {
  Inter,
  JetBrains_Mono,
  Noto_Sans_SC,
  Schibsted_Grotesk,
} from "next/font/google";
import { getServerSession } from "next-auth";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/providers/session-provider";
import { SessionExpiryWatcher } from "@/components/providers/session-expiry-watcher";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getServerLocale } from "@/i18n/server";
import { authOptions } from "@/lib/auth";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const schibstedGrotesk = Schibsted_Grotesk({
  variable: "--font-schibsted-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

// CJK 显示字体：世界的中文标题声音不能落回系统默认（finish review 指令）。
// next/font 按 unicode-range 分片，只有用到的字形分片会被下载。
const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aivora — AI Video Growth Platform",
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
      className={`${inter.variable} ${schibstedGrotesk.variable} ${notoSansSC.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="h-full antialiased">
        <span
          hidden
          data-design-contract="aivora-glass"
          dangerouslySetInnerHTML={{
            __html: [
              "<!--",
              "THESIS: 小商家的整条出片生产线悬在一块深色玻璃工作台上；拒绝「白底卡片格 SaaS 仪表盘」的范式。",
              "OWN-WORLD: 近黑暖石墨空气，右上品牌橙光源（强度随进行中的生成任务抬升）、左下冷石板对光、胶片颗粒；三档玻璃——backdrop 模糊的结构 pane、薄膜反光的内容卡、吸光的下沉 well；白透明 hairline 边 + 镜面高光边；圆角 10/14/20；Schibsted Grotesk + Noto Sans SC 标题、Inter 正文、JetBrains Mono 等宽数字；品牌橙只给品牌标记（含登录门主标题的品牌宣言行）、当前项、需行动的数字。",
              "STORY: 打开即知这是专业出片台——玻璃后透出的光就是正在发生的生成任务；看批次、挑赢家、再补量。",
              "FIRST VIEWPORT: 左侧玻璃侧栏 + 顶部玻璃工作条，主区为内容玻璃卡阵列，主行动为橙色实心按钮。",
              "FORM: 用户钦定毛玻璃（glassmorphism），seed key: aivora-glass；未跑 concept-seed（brief-pinned direction beats the roll）。",
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
