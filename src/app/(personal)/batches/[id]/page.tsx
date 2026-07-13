import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getBatchStatus } from "@/lib/services/batch-service";
import {
  BatchMonitor,
  type BatchMonitorData,
} from "@/components/batch/batch-monitor";

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
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/personal/videos"
          className="text-xs text-white/45 hover:text-white"
        >
          ← 返回我的视频
        </Link>
        <Link href="/batch-create" className="glass-btn text-xs">
          新建批次
        </Link>
      </div>
      <BatchMonitor initialBatch={batch as unknown as BatchMonitorData} />
    </div>
  );
}
