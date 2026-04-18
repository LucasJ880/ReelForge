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
  Users,
  Crown,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { useIsAdmin, useIsPro } from "@/lib/hooks/use-role";

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
  const isAdmin = useIsAdmin();
  const isPro = useIsPro();

  function NavItem({
    href,
    label,
    icon: Icon,
    isActive,
  }: {
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    isActive: boolean;
  }) {
    return (
      <Link
        href={href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors duration-150",
          isActive
            ? "bg-white/[0.05] text-white font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
        )}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full bg-primary" />
        )}
        <Icon className={cn("h-[17px] w-[17px] shrink-0", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground/90")} />
        {label}
      </Link>
    );
  }

  function NavContent() {
    return (
      <>
        <div className="px-4 pt-5 pb-6">
          <Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
            <Logo size={28} />
            <span className="text-[15px] font-semibold text-white tracking-tight">
              Aivora
            </span>
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-5">
          <div className="space-y-0.5">
            {mainNav
              .filter((item) => isPro || item.href !== "/batches")
              .map((item) => {
                const createPaths = ["/projects/new", "/batches/new"];
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href) &&
                    !createPaths.includes(pathname));
                return (
                  <NavItem
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    isActive={isActive}
                  />
                );
              })}
          </div>

          {isPro && (
            <div>
              <p className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 font-medium">
                创作
              </p>
              <div className="space-y-0.5">
                {createNav.map((item) => (
                  <NavItem
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    isActive={pathname === item.href}
                  />
                ))}
              </div>
            </div>
          )}

          {!isPro && !isAdmin && (
            <div>
              <p className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 font-medium">
                升级
              </p>
              <div className="space-y-0.5">
                <NavItem
                  href="/pricing"
                  label="订阅 Pro"
                  icon={Crown}
                  isActive={pathname === "/pricing"}
                />
              </div>
            </div>
          )}

          {isAdmin && (
            <div>
              <p className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 font-medium">
                管理后台
              </p>
              <div className="space-y-0.5">
                <NavItem
                  href="/admin/users"
                  label="用户与订阅"
                  icon={Users}
                  isActive={pathname.startsWith("/admin/users")}
                />
              </div>
            </div>
          )}
        </nav>

        <div className="px-3 py-3 border-t border-white/[0.05] space-y-0.5">
          <NavItem
            href="/settings"
            label="设置"
            icon={Settings}
            isActive={pathname === "/settings"}
          />
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] text-muted-foreground/70 hover:text-foreground/90 hover:bg-white/[0.03] transition-colors duration-150"
          >
            <LogOut className="h-[17px] w-[17px]" />
            退出
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 md:hidden flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-card text-white shadow-lg"
        aria-label="打开菜单"
      >
        <Menu className="h-4 w-4" />
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[220px] flex flex-col bg-sidebar transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-3 text-muted-foreground hover:text-white"
          aria-label="关闭菜单"
        >
          <X className="h-4 w-4" />
        </button>
        <NavContent />
      </aside>

      <aside className="hidden md:flex w-[220px] flex-col bg-sidebar border-r border-sidebar-border shrink-0">
        <NavContent />
      </aside>
    </>
  );
}
