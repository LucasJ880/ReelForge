import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getServerSession } from "next-auth";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/providers/session-provider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getServerLocale } from "@/i18n/server";
import { authOptions } from "@/lib/auth";
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
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
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
