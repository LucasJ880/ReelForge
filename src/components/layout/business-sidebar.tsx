"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Home,
  Wand2,
  PackageOpen,
  Sparkles,
  Plug,
  TrendingUp,
  Lightbulb,
  LogOut,
  CreditCard,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const BUSINESS_NAV: NavItem[] = [
  { href: "/business", label: "Home", icon: Home },
  { href: "/business/create-ad-video", label: "Create Ad Video", icon: Wand2 },
  { href: "/business/products", label: "Products", icon: PackageOpen },
  { href: "/business/creative-studio", label: "Creative Studio", icon: Sparkles },
  { href: "/business/integrations", label: "Integrations", icon: Plug },
  { href: "/business/performance", label: "Performance", icon: TrendingUp },
  { href: "/business/recommendations", label: "Recommendations", icon: Lightbulb },
  { href: "/business/billing", label: "Billing", icon: CreditCard },
];

export function BusinessSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  return (
    <aside className="hidden md:flex flex-col w-60 border-r border-white/5 bg-sidebar shrink-0">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/5">
        <Logo size={24} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Aivora</span>
          <span className="text-[10px] text-muted-foreground">Business</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {BUSINESS_NAV.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/business" && pathname.startsWith(item.href + "/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
              {item.badge && (
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 border border-white/10 rounded px-1 py-0.5">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/5 px-3 py-3 space-y-1">
        <LanguageSwitcher variant="sidebar" />
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
          <div className="truncate">{session?.user.email}</div>
          <div className="text-[10px] text-muted-foreground/60">Business</div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
