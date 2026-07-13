import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { getBatchStatus } from "@/lib/services/batch-service";
import { BatchMonitor, type BatchMonitorData } from "@/components/batch/batch-monitor";
import { Button } from "@/components/ui/button";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function PlatformBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  if (!session?.user?.id) redirect(`/login?from=/app/batches/${id}`);
  const batch = await getBatchStatus(id, session.user.id).catch(() => null);
  if (!batch) notFound();
  const copy = getPlatformCopy(await getServerLocale()).batches;
  return (
    <div className="editorial-page-stack min-w-0">
      <nav aria-label={copy.monitorNav} className="flex flex-wrap items-center justify-between gap-3">
        <Button render={<Link href="/app/batches" />} variant="ghost" size="sm">
          <ArrowLeft aria-hidden />{copy.back}
        </Button>
        <Button render={<Link href="/app/batches/new" />} size="sm">
          <Plus aria-hidden />{copy.new}
        </Button>
      </nav>
      <BatchMonitor initialBatch={batch as unknown as BatchMonitorData} />
    </div>
  );
}
