import { Sparkles } from "lucide-react";

export function ComingSoonHero({
  eyebrow,
  title,
  subtitle,
  bullets,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  bullets: string[];
}) {
  return (
    <div className="rounded-(--radius-lg) border border-white/10 bg-card/40 p-10">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Sparkles className="h-5 w-5" />
        <span className="text-xs uppercase tracking-wider">{eyebrow}</span>
      </div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-base text-muted-foreground max-w-xl">
        {subtitle}
      </p>

      <ul className="mt-7 space-y-2 text-sm text-foreground/80 max-w-xl">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span className="text-muted-foreground mt-1">·</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
