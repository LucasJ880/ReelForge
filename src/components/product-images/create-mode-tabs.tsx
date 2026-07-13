"use client";

import Link from "next/link";
import { ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";

export function CreateModeTabs({ active }: { active: "video" | "image" }) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).create;
  const items = [
    { id: "video" as const, href: "/app/create", label: copy.video, icon: Video },
    { id: "image" as const, href: "/app/create/images", label: copy.image, icon: ImageIcon },
  ];
  return (
    <nav aria-label={copy.modeNav} className="inline-flex rounded-(--radius-md) border border-border bg-muted p-1">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active === item.id ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-(--radius-sm) px-4 text-body font-medium transition-colors",
              active === item.id
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
