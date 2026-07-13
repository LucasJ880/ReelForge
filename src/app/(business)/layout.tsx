import { BusinessSidebar } from "@/components/layout/business-sidebar";
import { requirePersonaPage } from "@/lib/api-auth";

export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePersonaPage(["BUSINESS"], "/business");
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <BusinessSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto pb-16 pt-16 md:pb-0 md:pt-0">
        <div className="editorial-page">{children}</div>
      </main>
    </div>
  );
}
