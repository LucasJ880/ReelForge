import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReelForge — TikTok AI 短视频自动化",
  description: "AI 驱动的 TikTok 短视频内容生成、发布和数据分析平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="h-full antialiased">
        <div className="flex h-full">
          <AppSidebar />
          <div className="flex flex-1 flex-col min-w-0">
            <AppHeader />
            <main className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-6">
              {children}
            </main>
          </div>
        </div>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
