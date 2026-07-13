import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { getBatchStatus } from "@/lib/services/batch-service";
import {
  BatchMonitor,
  type BatchMonitorData,
} from "@/components/batch/batch-monitor";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function BatchMonitorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  if (!session?.user?.id) redirect(`/login?from=/batches/${id}`);

  const batch = await getBatchStatus(id, session.user.id).catch(() => null);
  if (!batch) notFound();

  return (
    <main className="min-w-0 space-y-8">
      <nav
        aria-label="批次监控导航"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <Button
          render={<Link href="/personal/videos" />}
          variant="ghost"
          size="sm"
        >
          <ArrowLeft aria-hidden />
          返回我的视频
        </Button>
        <Button render={<Link href="/batch-create" />} size="sm">
          <Plus aria-hidden />
          新建批次
        </Button>
      </nav>
      <BatchMonitor initialBatch={batch as unknown as BatchMonitorData} />
    </main>
  );
}
