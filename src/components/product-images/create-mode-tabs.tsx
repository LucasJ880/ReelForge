"use client";

import Link from "next/link";
import { ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";

/** 视频 / 产品图两个创作台的切换：当前项是信号青细线 + 青字，其余是钢灰字。 */
export function CreateModeTabs({ active }: { active: "video" | "image" }) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).create;
  const items = [
    { id: "video" as const, href: "/app/create", label: copy.video, icon: Video },
    { id: "image" as const, href: "/app/create/images", label: copy.image, icon: ImageIcon },
  ];
  return (
    <nav aria-label={copy.modeNav} className="inline-flex gap-0.5 rounded-(--radius-md) border border-border bg-sunken p-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const current = active === item.id;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex h-(--control-height) items-center gap-2 rounded-(--radius-sm) border px-3.5 text-meta font-medium transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
              current
                ? "border-(--accent-line) bg-active text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground",
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
