import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { contactEmail } from "@/lib/config/contact";
import {
  BatchNotFoundError,
  getBatchStatus,
  toCustomerBatchStatus,
} from "@/lib/services/batch-service";
import { BatchMonitor, type BatchMonitorData } from "@/components/batch/batch-monitor";
import { Button } from "@/components/ui/button";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";
import { isShowcaseBatchAllowed, resolveShowcaseFor } from "@/lib/services/showcase-library";

export const dynamic = "force-dynamic";

export default async function PlatformBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  if (!session?.user?.id) redirect(`/login?from=/app/batches/${id}`);
  const routeState = await getCustomerRouteRehearsalState("batchDetail");
  if (routeState === "empty") notFound();
  let batch: Awaited<ReturnType<typeof getBatchStatus>>;
  /// 样片批次（别人的批次）只读：不轮询、不出现重试 / 取消（1025 · B2.9）
  let readOnly = false;
  try {
    batch = await getBatchStatus(id, session.user.id);
  } catch (error) {
    if (!(error instanceof BatchNotFoundError)) throw error;
    // 命中 SunnyShutter 样片白名单（src/lib/config/showcase-allowlist.ts）的批次以只读方式呈现；否则 404。
    // 白名单默认空：样片账号的批次一律 404（2026-10-25 审计 A10）。
    const showcase = await resolveShowcaseFor(session.user.id);
    if (!showcase) notFound();
    const showcaseUserId = showcase.ownerId;
    try {
      batch = await getBatchStatus(id, showcaseUserId);
      readOnly = true;
    } catch (showcaseError) {
      if (showcaseError instanceof BatchNotFoundError) notFound();
      throw showcaseError;
    }
    if (!isShowcaseBatchAllowed(batch.videoJobs, showcase.allow)) notFound();
  }
  const copy = getPlatformCopy(await getServerLocale()).batches;
  return (
    <div className="x-stack min-w-0">
      <nav aria-label={copy.monitorNav} className="flex flex-wrap items-center justify-between gap-3">
        <Button render={<Link href="/app/batches" />} variant="ghost" size="sm">
          <ArrowLeft aria-hidden />{copy.back}
        </Button>
        <Button render={<Link href="/app/batches/new" />} variant="outline" size="sm">
          <Plus aria-hidden />{copy.new}
        </Button>
      </nav>
      <BatchMonitor
        initialBatch={
          toCustomerBatchStatus(batch) as unknown as BatchMonitorData
        }
        readOnly={readOnly}
        contactEmail={contactEmail()}
      />
    </div>
  );
}
