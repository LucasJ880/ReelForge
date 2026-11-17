import type { Metadata } from "next";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

/// 页面本身是客户端组件，标签页标题放在这一层
export async function generateMetadata(): Promise<Metadata> {
  return { title: getPlatformCopy(await getServerLocale()).auth.registerTab };
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
