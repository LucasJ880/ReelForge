import { Coins, Megaphone, Rocket } from "lucide-react";
import { PetSection } from "./pet-section";
import {
  BUSINESS_MODEL_SECTION,
  type RevenueLine,
} from "@/lib/demo/pet-content-kit-demo-data";

const LINE_ICON = [Coins, Megaphone, Rocket] as const;

export function BusinessModel() {
  const s = BUSINESS_MODEL_SECTION;
  return (
    <PetSection
      id="business-model"
      eyebrow={s.eyebrow}
      title={s.title}
      description={s.description}
    >
      <div className="grid gap-5 lg:grid-cols-3">
        {s.lines.map((line, i) => (
          <RevenueCard key={line.tag} line={line} icon={LINE_ICON[i] ?? Coins} />
        ))}
      </div>

      <div className="mt-6 rounded-3xl border border-[var(--pet-teal)]/25 bg-[var(--pet-teal)]/6 p-6">
        <h3 className="text-sm font-semibold text-foreground">单位经济逻辑</h3>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {s.unitEconomics}
        </p>
      </div>
    </PetSection>
  );
}

function RevenueCard({
  line,
  icon: Icon,
}: {
  line: RevenueLine;
  icon: typeof Coins;
}) {
  return (
    <div className="pet-surface flex flex-col rounded-3xl p-6">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--pet-orange)]/12 text-[color:var(--pet-orange)]">
        <Icon size={20} />
      </div>
      <span className="mt-4 inline-flex w-fit rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-[color:var(--pet-teal)]">
        {line.tag}
      </span>
      <h3 className="mt-3 text-base font-semibold text-foreground">
        {line.title}
      </h3>
      <p className="mt-2 flex-1 text-sm leading-7 text-muted-foreground">
        {line.body}
      </p>
      <ul className="mt-4 space-y-2 border-t border-border pt-4">
        {line.pricing.map((p) => (
          <li
            key={p}
            className="flex items-start gap-2 text-xs leading-6 text-foreground/80"
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pet-teal)]" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
