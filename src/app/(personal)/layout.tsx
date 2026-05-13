import { PersonalSidebar } from "@/components/layout/personal-sidebar";
import { requirePersonaPage } from "@/lib/api-auth";

export default async function PersonalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePersonaPage(["PERSONAL"], "/personal");
  return (
    <div className="flex h-full bg-sidebar">
      <PersonalSidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 py-8 w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
