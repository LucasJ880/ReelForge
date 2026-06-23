import { PetSection } from "./pet-section";
import {
  TEAM_SECTION,
  type TeamMember,
} from "@/lib/demo/pet-content-kit-demo-data";

export function TeamSection() {
  const s = TEAM_SECTION;
  return (
    <PetSection
      id="team"
      eyebrow={s.eyebrow}
      title={s.title}
      description={s.description}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {s.members.map((member) => (
          <MemberCard key={member.name} member={member} />
        ))}
      </div>

      {s.whyFit ? (
        <div className="mt-6 rounded-3xl border border-(--pet-teal)/25 bg-(--pet-teal)/6 p-6">
          <h3 className="text-base font-semibold text-foreground">
            {s.whyFit.title}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
            {s.whyFit.intro}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {s.whyFit.points.map((point) => (
              <div
                key={point.title}
                className="rounded-2xl border border-border bg-card/60 p-4"
              >
                <p className="text-sm font-semibold text-(--pet-teal)">
                  {point.title}
                </p>
                <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                  {point.body}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/85">
            {s.whyFit.closing}
          </p>
        </div>
      ) : null}

      <p className="mt-5 text-xs leading-6 text-muted-foreground">{s.note}</p>
    </PetSection>
  );
}

function MemberCard({ member }: { member: TeamMember }) {
  return (
    <div className="pet-surface flex flex-col gap-4 rounded-3xl p-6 sm:flex-row sm:items-start">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-[var(--pet-orange)] to-[var(--pet-teal)] text-xl font-bold text-white shadow-sm">
        {member.initials}
      </div>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-foreground">{member.name}</h3>
        <p className="text-sm font-medium text-[color:var(--pet-teal)]">
          {member.role}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{member.focus}</p>
        {member.bio ? (
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            {member.bio}
          </p>
        ) : null}
        <ul className="mt-3 space-y-2">
          {member.bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-2 text-xs leading-6 text-foreground/80"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pet-orange)]" />
              {b}
            </li>
          ))}
        </ul>
        {member.value ? (
          <p className="mt-3 rounded-2xl border border-(--pet-orange)/25 bg-(--pet-orange)/6 p-3 text-xs leading-6 text-foreground/85">
            {member.value}
          </p>
        ) : null}
      </div>
    </div>
  );
}
