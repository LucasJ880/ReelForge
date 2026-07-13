import Link from "next/link";
import { ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export function CreateModeTabs({ active }: { active: "video" | "image" }) {
  const items = [
    { id: "video" as const, href: "/app/create", label: "生成视频", icon: Video },
    { id: "image" as const, href: "/app/create/images", label: "产品图片", icon: ImageIcon },
  ];
  return (
    <nav aria-label="创作模式" className="inline-flex rounded-(--radius-md) border border-border bg-muted p-1">
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
