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
} from "lucide-react";
import { cn } from "@/lib/utils";

const mainNav = [
  { href: "/", label: "工作台", icon: LayoutDashboard },
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
        <div className="px-5 pt-6 pb-8">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white text-xs font-bold tracking-tight">
              RF
            </div>
            <span className="text-[15px] font-semibold text-white tracking-tight">
              ReelForge
            </span>
          </Link>
        </div>

        {/* Main nav */}
        <nav className="flex-1 px-3 space-y-6">
          <div className="space-y-1">
            {mainNav.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-150",
                    isActive
                      ? "bg-white/10 text-white font-medium"
                      : "text-zinc-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div>
            <p className="px-3 mb-2 text-[10px] uppercase tracking-[0.15em] text-zinc-500 font-medium">
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
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-150",
                      isActive
                        ? "bg-white/10 text-white font-medium"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/5">
          <Link
            href="/settings"
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] transition-all duration-150",
              pathname === "/settings"
                ? "text-white"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <Settings className="h-4 w-4" />
            设置
          </Link>
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
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-56 flex flex-col bg-zinc-950 transition-transform duration-200 md:hidden",
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
      <aside className="hidden md:flex w-56 flex-col bg-zinc-950 shrink-0">
        <NavContent />
      </aside>
    </>
  );
}
