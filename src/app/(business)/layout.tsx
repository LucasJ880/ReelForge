import { BusinessSidebar } from "@/components/layout/business-sidebar";
import { requirePersonaPage } from "@/lib/api-auth";

export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePersonaPage(["BUSINESS"], "/business");
  return (
    <div className="flex h-full bg-sidebar">
      <BusinessSidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 py-8 w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
