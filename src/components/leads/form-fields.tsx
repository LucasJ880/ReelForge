import { cn } from "@/lib/utils";

/**
 * 询盘 / 试点表单的字段外壳：标签在上、控件在下、说明在后。
 * 原生 select 套下沉井材质（与 Input 同一套边框、焦点环、错误态）。
 */
export function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={id} className="block text-meta font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-meta text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "x-well h-(--control-height) w-full min-w-0 rounded-(--radius-md) border border-input px-3 text-body text-foreground outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

/** 蜜罐：移出屏幕、读屏隐藏、跳过 Tab；真人看不到也不会填。 */
export function HoneypotField({ name, label, value, onChange }: { name: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div aria-hidden className="pointer-events-none absolute -left-[9999px] top-auto size-px overflow-hidden">
      <label htmlFor={`hp-${name}`}>{label}</label>
      <input
        id={`hp-${name}`}
        name={name}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function FormAlert({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-(--radius-md) border px-3 py-2 text-meta",
        tone === "error" ? "border-danger bg-danger-soft text-danger" : "border-border bg-raised text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

export function ConsentCheckbox({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 text-meta leading-relaxed text-muted-foreground">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-(--accent)"
      />
      <span>{children}</span>
    </label>
  );
}
