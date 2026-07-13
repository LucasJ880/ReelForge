import { PersonalGlassShell } from "@/components/personal/personal-glass-shell";
import { requirePersonaPage } from "@/lib/api-auth";

export default async function PersonalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePersonaPage(["PERSONAL"], "/personal");
  return (
    <div className="min-h-screen bg-background">
      <PersonalGlassShell email={session?.user?.email ?? null}>
        {children}
      </PersonalGlassShell>
    </div>
  );
}
