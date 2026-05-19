import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { UsageDashboard } from "@/components/billing/usage-dashboard";
import { authOptions } from "@/lib/auth";
import {
  buildDefaultUsagePayload,
  loadUsagePayloadForSession,
} from "@/lib/services/usage-payload";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ upgraded?: string }>;
};

export default async function BillingPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/personal/billing");

  const sp = await searchParams;
  const initial = session.user?.id
    ? await loadUsagePayloadForSession(session)
    : buildDefaultUsagePayload(session);

  return (
    <UsageDashboard
      persona="personal"
      initial={initial}
      upgraded={sp.upgraded === "1"}
    />
  );
}
