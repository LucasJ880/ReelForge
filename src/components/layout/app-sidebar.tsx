"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FolderPlus,
  List,
  Settings,
  Layers,
  Zap,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";

const mainNav = [
  { href: "/dashboard", label: "工作台", icon: LayoutDashboard },
  { href: "/projects", label: "作品库", icon: List },
  { href: "/batches", label: "批量任务", icon: Layers },
];

const createNav = [
  { href: "/projects/new", label: "单个创作", icon: FolderPlus },
  { href: "/batches/new", label: "批量生成", icon: Zap },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function NavContent() {
    return (
      <>
        {/* Logo */}
        <div className="px-4 pt-5 pb-6">
          <Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
            <Logo size={30} />
            <span className="text-[15px] font-semibold text-white tracking-tight">
              Aivora
            </span>
          </Link>
        </div>

        {/* Main nav */}
        <nav className="flex-1 px-3 space-y-5">
          <div className="space-y-1">
            {mainNav.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-all duration-200",
                    isActive
                      ? "bg-gradient-to-r from-violet-500/20 to-fuchsia-500/10 text-white font-medium shadow-sm shadow-violet-500/5"
                      : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06]"
                  )}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
                  )}
                  <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive && "text-violet-300")} />
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div>
            <p className="px-3 mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-medium">
              创作
            </p>
            <div className="space-y-1">
              {createNav.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-all duration-200",
                      isActive
                        ? "bg-gradient-to-r from-violet-500/20 to-fuchsia-500/10 text-white font-medium shadow-sm shadow-violet-500/5"
                        : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06]"
                    )}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
                    )}
                    <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive && "text-violet-300")} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-white/[0.05] space-y-0.5">
          <Link
            href="/settings"
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-all duration-200",
              pathname === "/settings"
                ? "text-zinc-200"
                : "text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.04]"
            )}
          >
            <Settings className="h-[18px] w-[18px]" />
            设置
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.04] transition-all duration-200"
          >
            <LogOut className="h-[18px] w-[18px]" />
            退出
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 md:hidden flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-white shadow-lg"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[220px] flex flex-col bg-[#08080e] transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-3 text-zinc-500 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <NavContent />
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-[220px] flex-col bg-[#08080e] border-r border-white/[0.05] shrink-0">
        <NavContent />
      </aside>
    </>
  );
}
