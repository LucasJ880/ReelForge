import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isInternalRacingUser, listRacingRounds } from "@/lib/services/racing-service";
import { RacingDashboard } from "@/components/racing/racing-dashboard";
import { Button } from "@/components/ui/button";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";

export const dynamic = "force-dynamic";

export default async function PlatformRacingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/racing");
  const routeState = await getCustomerRouteRehearsalState("racing");
  const rounds = routeState === "empty" ? [] : await listRacingRounds({
    userId: session.user.id,
    canViewAll: isInternalRacingUser(session.user.userType),
  });
  const copy = getPlatformCopy(await getServerLocale()).racing;
  return (
    <div className="editorial-page-stack">
      <header className="max-w-3xl space-y-3">
        <p className="studio-label text-muted-foreground">{copy.kicker}</p>
        <h1 className="editorial-display">{copy.title}</h1>
        <p className="text-body text-muted-foreground">{copy.subtitle}</p>
      </header>
      {rounds.length === 0 ? <section data-route-state="empty" className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
        <p className="text-body text-muted-foreground">{copy.empty}</p>
        <Button render={<Link href="/app/create" />} className="mt-5">{copy.start}<ArrowRight aria-hidden /></Button>
      </section> : <RacingDashboard rounds={rounds} />}
    </div>
  );
}
