"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Package,
  Swords,
  ClipboardCheck,
  Send,
  BarChart3,
  Sparkles,
  Settings,
  LogOut,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

const NAV: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: readonly ("SUPER_ADMIN" | "OPERATOR" | "REVIEWER")[];
}[] = [
  { href: "/orders", label: "交付单", icon: Package },
  { href: "/rounds", label: "赛马轮次", icon: Swords },
  { href: "/qa", label: "QA 审核", icon: ClipboardCheck },
  { href: "/publish", label: "发布队列", icon: Send },
  { href: "/metrics", label: "数据回流", icon: BarChart3 },
  { href: "/distillation", label: "创意蒸馏", icon: Sparkles },
  {
    href: "/settings",
    label: "设置",
    icon: Settings,
    roles: ["SUPER_ADMIN"],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user.role ?? "OPERATOR";

  return (
    <aside className="hidden md:flex flex-col w-60 border-r border-white/[0.05] bg-sidebar shrink-0">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/[0.05]">
        <Logo size={24} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Aivora</span>
          <span className="text-[10px] text-muted-foreground">内部交付系统</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.filter((n) => !n.roles || n.roles.includes(role)).map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/[0.05] px-3 py-3 space-y-1">
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
          <div className="truncate">{session?.user.email}</div>
          <div className="text-[10px] text-muted-foreground/60">
            {roleLabel(role)}
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </button>
      </div>
    </aside>
  );
}

function roleLabel(role: string) {
  switch (role) {
    case "SUPER_ADMIN":
      return "超级管理员";
    case "OPERATOR":
      return "运营";
    case "REVIEWER":
      return "审核员";
    default:
      return role;
  }
}
