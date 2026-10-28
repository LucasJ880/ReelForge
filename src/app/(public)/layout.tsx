/**
 * Public route group: no auth required, no sidebar.
 * 用于 /privacy、/terms 等公开法务页。
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-full bg-background text-foreground">
      {children}
    </main>
  );
}
