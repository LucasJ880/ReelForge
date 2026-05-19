import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PLATFORMS = [
  {
    id: "tiktok",
    name: "TikTok",
    status: "manual" as const,
    description:
      "Import view / completion metrics via CSV after you publish. OAuth auto-sync is planned.",
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
                {p.status === "manual" ? "CSV import" : "Coming soon"}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-dashed border-white/15 bg-card/20 p-6 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">Today:</strong> after posting on
          TikTok, ask your operator to import metrics CSV in the internal
          console, or paste publish URLs on the product detail page when that
          flow is enabled.
        </p>
        <p className="mt-3">
          Once metrics appear in{" "}
          <Link href="/business/performance" className="text-primary hover:underline">
            Performance
          </Link>
          ,{" "}
          <Link
            href="/business/recommendations"
            className="text-primary hover:underline"
          >
            Recommendations
          </Link>{" "}
          will prioritize winning hooks automatically.
        </p>
      </div>
    </div>
  );
}
