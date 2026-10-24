import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EmptyStateAction =
  | { label: React.ReactNode; href: string; icon?: React.ReactNode }
  | { label: React.ReactNode; onClick: () => void; icon?: React.ReactNode };

/**
 * 统一空态（1025 · B2.2）：一块 hull 面板 + 一句人话 + 至多一个描边行动。
 *
 * - 按钮永远是描边：页头已经有一枚实心主钮，空态再放一枚就是「一页两枚」。
 * - 不加 x-frame 角标（角标只给主读数区），不用虚线框（虚线不在材质体系里）。
 * - 「零就写零」：这里只说「还没有」，不放示例数字或假卡片。
 */
export function EmptyState({
  title,
  body,
  action,
  compact = false,
  className,
  ...props
}: {
  title?: React.ReactNode;
  body: React.ReactNode;
  action?: EmptyStateAction | null;
  /** 嵌在区块里的小空态（品牌页三块、成品库分区）：更紧的内边距。 */
  compact?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"section">, "title" | "children">) {
  return (
    <section
      data-slot="empty-state"
      className={cn("x-panel", compact ? "px-5 py-6" : "px-6 py-10", className)}
      {...props}
    >
      {title ? <h3 className="text-subhead font-medium text-foreground">{title}</h3> : null}
      <p className={cn("max-w-[56ch] text-body text-muted-foreground text-pretty", title ? "mt-1.5" : null)}>{body}</p>
      {action ? (
        "href" in action ? (
          <Button render={<Link href={action.href} />} variant="outline" size="sm" className="mt-4">
            {action.icon}
            {action.label}
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={action.onClick}>
            {action.icon}
            {action.label}
          </Button>
        )
      ) : null}
    </section>
  );
}
