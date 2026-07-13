import { Card } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-20 items-center border-b border-border bg-card px-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Aivora 首页"
        >
          <Logo size={40} />
          <span>
            <span className="block font-heading text-subhead">Aivora</span>
            <span className="block text-meta text-muted-foreground">
              Editorial Studio
            </span>
          </span>
        </Link>
      </header>
      <main className="grid min-h-[calc(100vh-5rem)] place-items-center px-4 py-10 sm:px-6">
        <Card className="w-full max-w-md">{children}</Card>
      </main>
    </div>
  );
}
