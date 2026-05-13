import Link from "next/link";
import { Wand2, PackageOpen, Sparkles, TrendingUp } from "lucide-react";

export default function BusinessHomePage() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ship ad videos that perform. Start a new one or pick up where you left off.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/business/create-ad-video"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <Wand2 className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">Create</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            New ad video
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Unified creative input: prompt, product images, logos, brand ending — one form.
          </p>
        </Link>

        <Link
          href="/business/products"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <PackageOpen className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">Manage</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            Your products
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Every video you&apos;ve created, grouped by product line.
          </p>
        </Link>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/5 bg-card/40 p-6">
          <div className="flex items-center gap-3 text-muted-foreground/60">
            <Sparkles className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">Coming Phase 2</span>
          </div>
          <h3 className="mt-3 text-base font-medium tracking-tight text-foreground/80">
            Creative Studio
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Side-by-side angle variants, A/B prompt tuning, performance-aware rewrites.
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-card/40 p-6">
          <div className="flex items-center gap-3 text-muted-foreground/60">
            <TrendingUp className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">Coming Phase 2</span>
          </div>
          <h3 className="mt-3 text-base font-medium tracking-tight text-foreground/80">
            Performance & recommendations
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Tie creative decisions to ROAS and platform pickup data, then auto-recommend the next video.
          </p>
        </div>
      </section>
    </div>
  );
}
