import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: Props) {
  return (
    <header
      className={cn(
        "mb-8 flex min-w-0 flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="editorial-display wrap-break-word">{title}</h1>
        {description && (
          <p className="mt-3 max-w-3xl text-body text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:max-w-[58%] lg:justify-end">{actions}</div>
      )}
    </header>
  );
}
