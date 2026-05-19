import { InternalSidebar } from "@/components/layout/internal-sidebar";
import { requireInternalPage } from "@/lib/api-auth";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireInternalPage("/internal");
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
