import { BusinessSidebar } from "@/components/layout/business-sidebar";
import { requireBusinessUser } from "@/lib/api-auth";
import { redirect } from "next/navigation";

export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const guard = await requireBusinessUser();
  if (!guard.ok) {
    redirect("/login?from=/business");
  }
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
