import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "danger" | "info" | "warning";
  className?: string;
}

export function StatusBadge({ children, tone = "neutral", className }: Props) {
  const toneClass = {
    neutral: "text-muted-foreground before:bg-muted-foreground",
    success: "text-success before:bg-success",
    danger: "text-danger before:bg-danger",
    info: "text-foreground before:bg-primary",
    warning: "text-warning before:bg-warning",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-2 text-meta font-medium before:size-1.5 before:rounded-full",
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function deliveryTone(status: string) {
  if (["COMPLETED"].includes(status)) return "success";
  if (["CANCELLED"].includes(status)) return "danger";
  if (["DRAFT"].includes(status)) return "neutral";
  return "info";
}

export function briefTone(status: string) {
  if (["ARCHIVED", "PUBLISHED", "QA_APPROVED"].includes(status)) return "success";
  if (["RENDER_FAILED", "QA_REJECTED", "DROPPED"].includes(status)) return "danger";
  if (["RENDERING", "RENDER_QUEUED", "METRICS_COLLECTING"].includes(status)) return "info";
  if (["QA_PENDING", "PUBLISH_PENDING"].includes(status)) return "warning";
  return "neutral";
}

export function qaTone(status: string) {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "CHANGES_REQUESTED") return "warning";
  return "info";
}

export function publishTone(status: string) {
  if (status === "PUBLISHED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "CANCELLED") return "neutral";
  return "info";
}
