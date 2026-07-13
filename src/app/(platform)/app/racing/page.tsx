import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isInternalRacingUser, listRacingRounds } from "@/lib/services/racing-service";
import { RacingDashboard } from "@/components/racing/racing-dashboard";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function PlatformRacingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/racing");
  const rounds = await listRacingRounds({
    userId: session.user.id,
    canViewAll: isInternalRacingUser(session.user.userType),
  }).catch(() => []);
  return (
    <div className="editorial-page-stack">
      <header className="max-w-3xl space-y-3">
        <p className="studio-label text-muted-foreground">Campaign racing</p>
        <h1 className="editorial-display">投放与赛马</h1>
        <p className="text-body text-muted-foreground">把同一创意的多个变体放进 12/24/48 小时窗口比较，用可见的证据完整度决定下一轮，而不是凭感觉追热点。</p>
      </header>
      {rounds.length === 0 ? <section className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
        <p className="text-body text-muted-foreground">还没有可比较的投放轮次。先生成一支成片，系统会为新项目保留三轮赛马空间。</p>
        <Button render={<Link href="/app/create" />} className="mt-5">开始首轮创作<ArrowRight aria-hidden /></Button>
      </section> : <RacingDashboard rounds={rounds} />}
    </div>
  );
}
