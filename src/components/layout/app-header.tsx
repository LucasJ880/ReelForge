"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, LayoutDashboard, List, FolderPlus, Settings, Layers, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "仪表板", icon: LayoutDashboard },
  { href: "/projects", label: "项目列表", icon: List },
  { href: "/projects/new", label: "新建项目", icon: FolderPlus },
  { href: "/batches", label: "批量任务", icon: Layers },
  { href: "/batches/new", label: "批量生成", icon: Zap },
  { href: "/settings", label: "设置", icon: Settings },
];

const pageTitles: Record<string, string> = {
  "/": "仪表板",
  "/projects": "项目列表",
  "/projects/new": "新建项目",
  "/batches": "批量任务",
  "/batches/new": "批量生成",
  "/settings": "设置",
};

export function AppHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const title =
    pageTitles[pathname] ||
    (pathname.startsWith("/batches/") ? "批次详情" :
    pathname.startsWith("/projects/") ? "项目详情" : "ReelForge");

  return (
    <header className="flex h-14 items-center border-b bg-white px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden mr-2"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white text-sm font-bold">
                  RF
                </div>
                <span className="text-lg font-semibold">ReelForge</span>
              </Link>
            </SheetTitle>
          </SheetHeader>
          <nav className="px-3 py-4 space-y-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    isActive
                      ? "bg-gray-100 text-gray-900 font-medium"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
      <div className="flex items-center gap-2 md:hidden mr-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black text-white text-xs font-bold">
            RF
          </div>
        </Link>
      </div>
      <h1 className="text-lg font-semibold">{title}</h1>
    </header>
  );
}
