"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

const pageTitles: Record<string, string> = {
  "/": "仪表板",
  "/projects": "项目列表",
  "/projects/new": "新建项目",
  "/settings": "设置",
};

export function AppHeader() {
  const pathname = usePathname();

  const title =
    pageTitles[pathname] ||
    (pathname.startsWith("/projects/") ? "项目详情" : "ReelForge");

  return (
    <header className="flex h-14 items-center border-b bg-white px-4 md:px-6">
      <Button variant="ghost" size="icon" className="md:hidden mr-2">
        <Menu className="h-5 w-5" />
      </Button>
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
