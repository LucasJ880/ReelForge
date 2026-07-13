import { InternalSidebar } from "@/components/layout/internal-sidebar";
import { requireInternalPage } from "@/lib/api-auth";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireInternalPage("/internal");
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <InternalSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto pb-16 pt-16 md:pb-0 md:pt-0">
        <div className="editorial-page">{children}</div>
      </main>
    </div>
  );
}
