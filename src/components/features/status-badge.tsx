import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "danger" | "info" | "warning";
  className?: string;
}

export function StatusBadge({ children, tone = "neutral", className }: Props) {
  const toneClass = {
    neutral: "bg-secondary text-muted-foreground",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    danger: "bg-destructive/10 text-destructive border-destructive/30",
    info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium",
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
