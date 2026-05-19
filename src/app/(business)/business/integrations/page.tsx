import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { BusinessMetricsForm } from "@/components/business/business-metrics-form";
import { authOptions } from "@/lib/auth";
import { listBusinessVideosForMetrics } from "@/lib/services/business-metrics-import";

export const dynamic = "force-dynamic";

const PLATFORMS = [
  {
    id: "tiktok",
    name: "TikTok",
    status: "manual" as const,
    description:
      "Publish on TikTok, then enter views and completion below — no internal console required.",
  },
  {
    id: "shopify",
    name: "Shopify",
    status: "planned" as const,
    description: "Pull product catalog and UTM-tagged landing pages.",
  },
  {
    id: "meta",
    name: "Meta Ads",
    status: "planned" as const,
    description: "Reels and Ads performance for cross-channel creative.",
  },
];

export default async function IntegrationsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/integrations");

  const videos =
    session.user?.id != null
      ? await listBusinessVideosForMetrics(session.user.id)
      : [];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Connections
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Integrations
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Connect platforms so Performance and Recommendations can use real
          ROAS and view-through data.
        </p>
      </header>

      <section className="rounded-xl border border-white/10 bg-card/30 p-6">
        <h2 className="text-lg font-semibold">TikTok 表现数据（自助录入）</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          发布后在 TikTok 后台查看数据，在此填写即可驱动 Performance 与
          Recommendations。
        </p>
        <div className="mt-6">
          <BusinessMetricsForm videos={videos} />
        </div>
      </section>

      <ul className="space-y-3">
        {PLATFORMS.map((p) => (
          <li
            key={p.id}
            className="rounded-xl border border-white/10 bg-card/30 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{p.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.description}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  p.status === "manual"
                    ? "bg-sky-500/15 text-sky-300"
                    : "bg-slate-500/15 text-slate-400"
                }`}
              >
                {p.status === "manual" ? "Self-serve" : "Coming soon"}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-dashed border-white/15 bg-card/20 p-6 text-sm text-muted-foreground">
        <p>
          录入后可在{" "}
          <Link
            href="/business/performance"
            className="text-primary hover:underline"
          >
            Performance
          </Link>{" "}
          查看汇总，{" "}
          <Link
            href="/business/recommendations"
            className="text-primary hover:underline"
          >
            Recommendations
          </Link>{" "}
          会优先推荐高表现 hook。
        </p>
      </div>
    </div>
  );
}
