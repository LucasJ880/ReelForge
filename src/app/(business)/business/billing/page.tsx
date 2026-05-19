import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { UsageDashboard } from "@/components/billing/usage-dashboard";
import { authOptions } from "@/lib/auth";
import { loadUsagePayloadForSession } from "@/lib/services/usage-payload";

export const dynamic = "force-dynamic";

export default async function BusinessBillingPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/billing");

  const initial = await loadUsagePayloadForSession(session).catch(() => null);
  if (!initial) {
    return (
      <p className="text-sm text-destructive">
        暂时无法加载用量，请稍后刷新页面。
      </p>
    );
  }

  return <UsageDashboard persona="business" initial={initial} />;
}
