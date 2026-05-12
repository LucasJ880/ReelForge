/**
 * Public route group: no auth required, no sidebar.
 * 用于 /persona, /showcase 等营销/选择页。
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
