import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadBusinessInsights } from "@/lib/services/business-insights-service";

export const dynamic = "force-dynamic";

export default async function CreativeStudioPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/creative-studio");

  const insights = await loadBusinessInsights(session.user.id).catch(() => null);
  const ready = insights?.videos.filter((v) => v.status === "ready") ?? [];
  const recent = insights?.videos.slice(0, 8) ?? [];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Variants
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Creative Studio
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Spin hook and CTA variants from existing products. Each row links to a
          new ad brief pre-filled from your last prompt.
        </p>
      </header>

      <div className="rounded-xl border border-white/10 bg-card/30 p-6">
        <h2 className="font-semibold">Quick actions</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/business/create-ad-video"
            className="inline-flex rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
          >
            New ad from scratch
          </Link>
          {ready[0] && (
            <Link
              href={`/business/create-ad-video?from=${encodeURIComponent(ready[0].orderId)}`}
              className="inline-flex rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
            >
              Variant of latest ready video
            </Link>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent products</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No videos yet. Create an ad to see variant shortcuts here.
          </p>
        ) : (
          <ul className="space-y-2">
            {recent.map((v) => (
              <li
                key={v.orderId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-card/20 px-4 py-3"
              >
                <div>
                  <p className="max-w-md truncate font-medium">{v.title}</p>
                  {v.hook ? (
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      Hook: {v.hook}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-3 text-sm">
                  <Link
                    href={`/business/products/${v.orderId}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    View
                  </Link>
                  <Link
                    href={`/business/create-ad-video?from=${encodeURIComponent(v.orderId)}`}
                    className="text-primary hover:underline"
                  >
                    New variant →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
