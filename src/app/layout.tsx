import type { Metadata } from "next";
import {
  Instrument_Serif,
  Inter,
  Noto_Sans_SC,
  Noto_Serif_SC,
} from "next/font/google";
import { getServerSession } from "next-auth";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/providers/session-provider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getServerLocale } from "@/i18n/server";
import { authOptions } from "@/lib/auth";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const notoSansSc = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const notoSerifSc = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  subsets: ["latin"],
  weight: "400",
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
      className={`${inter.variable} ${instrumentSerif.variable} ${notoSansSc.variable} ${notoSerifSc.variable} h-full`}
    >
      <body className="h-full antialiased">
        <AuthProvider session={session}>
          <I18nProvider initialLocale={locale}>
            {children}
            <Toaster richColors position="top-right" />
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
