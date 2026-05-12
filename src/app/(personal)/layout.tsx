import { PersonalSidebar } from "@/components/layout/personal-sidebar";
import { requirePersonalUser } from "@/lib/api-auth";
import { redirect } from "next/navigation";

export default async function PersonalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const guard = await requirePersonalUser();
  if (!guard.ok) {
    redirect("/login?from=/personal");
  }
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
