import { AppSidebar } from "@/components/layout/app-sidebar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full bg-zinc-950">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto bg-zinc-950">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
