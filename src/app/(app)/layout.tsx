import Link from "next/link";
import { AppSidebar } from "@/components/layout/app-sidebar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full bg-zinc-950">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto bg-zinc-950 flex flex-col min-h-screen">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-8 flex-1 w-full">
          {children}
        </div>
        <footer className="border-t border-white/[0.04] py-4 px-6">
          <div className="mx-auto max-w-6xl flex items-center justify-between text-[11px] text-zinc-600">
            <span>© 2026 Aivora</span>
            <div className="flex gap-4">
              <Link href="/terms" className="hover:text-zinc-400 transition-colors">Terms of Service</Link>
              <Link href="/privacy" className="hover:text-zinc-400 transition-colors">Privacy Policy</Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
