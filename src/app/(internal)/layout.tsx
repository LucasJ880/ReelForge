import { InternalSidebar } from "@/components/layout/internal-sidebar";
import { requireInternal } from "@/lib/api-auth";
import { redirect } from "next/navigation";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const guard = await requireInternal();
  if (!guard.ok) {
    redirect("/login?from=/internal");
  }
  return (
    <div className="flex h-full bg-sidebar">
      <InternalSidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 py-8 w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
