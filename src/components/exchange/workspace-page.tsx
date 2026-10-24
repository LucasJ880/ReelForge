import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { cn } from "@/lib/utils";
import { QuoteHeader, type QuoteHeaderProps } from "./quote-header";

/** 导轨上的一级区（与 platform-shell 的导航同一组 id）。 */
export type WorkspaceNavId = "plan" | "create" | "batches" | "wins" | "library" | "brands" | "templates" | "leads";

/** 页面标题 = 导航名：从同一本字典取，导航改名，页面标题跟着改。 */
export function workspaceNavTitle(nav: WorkspaceNavId, locale: Locale): string {
  return getDictionary(locale).shell.platformNav[nav];
}

/**
 * 工作区页面骨架（1025 · B2.1）：x-stack 容器 + 行情头 + 正文。
 *
 * 规则写进类型里，不靠记性：
 *  - 标题只能是导航名（传 `nav`，不接收自由文本标题）；口号进副标题。
 *  - 主行动是必填插槽，没有就写 `null`；模式切换单独一个插槽。
 *  - 读数墙与统计口径必填（零就写零）。
 *
 * 纯展示组件：不引服务端模块，server page 与 'use client' 组件都能用。
 */
export function WorkspacePage({
  nav,
  locale,
  children,
  className,
  testId,
  ...header
}: Omit<QuoteHeaderProps, "title" | "className"> & {
  nav: WorkspaceNavId;
  locale: Locale;
  children?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn("x-stack min-w-0", className)} data-workspace-page={nav} data-testid={testId}>
      <QuoteHeader title={workspaceNavTitle(nav, locale)} {...header} />
      {children}
    </div>
  );
}
