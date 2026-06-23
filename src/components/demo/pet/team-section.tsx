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
      </div>
    </div>
  );
}
