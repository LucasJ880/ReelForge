import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { deriveBusinessStatus, type BusinessVideoStatus } from "@/lib/video-generation/business-status";
import type { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ highlight?: string }>;
}

interface ProductRow {
  id: string;
  title: string;
  productCategory: string;
  updatedAt: Date;
  briefId: string | null;
  briefStatus: VideoBriefStatus | null;
  finalVideoStatus: FinalVideoStatus | null;
  finalVideoUrl: string | null;
  finalThumbnailUrl: string | null;
  aspectRatio: string | null;
  durationSec: number | null;
  segmentCount: number;
  segmentsSucceeded: number;
  jobStatuses: VideoJobStatus[];
  businessStatus: BusinessVideoStatus;
  businessLabel: string;
}

const STATUS_CHIP_CLASS: Record<BusinessVideoStatus, string> = {
  planning: "bg-slate-500/15 text-slate-300",
  generating: "bg-amber-500/15 text-amber-300",
  assembling: "bg-sky-500/15 text-sky-300",
  ready: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-rose-500/15 text-rose-300",
};

async function loadProductRows(userId: string): Promise<ProductRow[]> {
  const orders = await db.deliveryOrder.findMany({
    where: { createdById: userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      productCategory: true,
      updatedAt: true,
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 1,
        select: {
          angles: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              videoBrief: {
                select: {
                  id: true,
                  status: true,
                  aspectRatio: true,
                  durationSec: true,
                  finalVideoUrl: true,
                  finalThumbnailUrl: true,
                  finalVideo: {
                    select: {
                      status: true,
                      stitchedVideoUrl: true,
                      thumbnailUrl: true,
                      segmentCount: true,
                    },
                  },
                  videoJobs: {
                    select: { status: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return orders.map((o) => {
    const brief = o.rounds[0]?.angles[0]?.videoBrief ?? null;
    const finalVideo = brief?.finalVideo ?? null;
    const jobStatuses = brief?.videoJobs?.map((j) => j.status) ?? [];
    const segmentsSucceeded = jobStatuses.filter((s) => s === "SUCCEEDED").length;
    const segmentCount = finalVideo?.segmentCount ?? jobStatuses.length;
    const status = deriveBusinessStatus({
      briefStatus: brief?.status ?? null,
      finalVideoStatus: finalVideo?.status ?? null,
      segmentsSucceeded,
      segmentsTotal: segmentCount,
      jobStatuses,
    });
    return {
      id: o.id,
      title: o.title,
      productCategory: o.productCategory,
      updatedAt: o.updatedAt,
      briefId: brief?.id ?? null,
      briefStatus: brief?.status ?? null,
      finalVideoStatus: finalVideo?.status ?? null,
      finalVideoUrl:
        finalVideo?.stitchedVideoUrl ?? brief?.finalVideoUrl ?? null,
      finalThumbnailUrl:
        finalVideo?.thumbnailUrl ?? brief?.finalThumbnailUrl ?? null,
      aspectRatio: brief?.aspectRatio ?? null,
      durationSec: brief?.durationSec ?? null,
      segmentCount,
      segmentsSucceeded,
      jobStatuses,
      businessStatus: status.status,
      businessLabel: status.label,
    } satisfies ProductRow;
  });
}

export default async function BusinessProductsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/products");

  const sp = await searchParams;
  const highlight = sp?.highlight ?? null;

  const products = await loadProductRows(session.user.id).catch(
    () => [] as ProductRow[],
  );

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Products</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            All ad videos you have created, grouped by product line.
          </p>
        </div>
        <Link
          href="/business/create-ad-video"
          className="inline-flex items-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
        >
          New ad video
        </Link>
      </header>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-card/30 p-12 text-center">
          <h2 className="text-lg font-semibold tracking-tight">
            No products yet
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Start with the unified creative input. Aivora will group your videos by product automatically.
          </p>
          <Link
            href="/business/create-ad-video"
            className="mt-6 inline-flex items-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Create your first video
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {products.map((p) => {
            const isHighlighted = highlight && p.id === highlight;
            return (
              <li
                key={p.id}
                className={
                  "rounded-lg border p-5 transition-colors " +
                  (isHighlighted
                    ? "border-emerald-400/40 bg-emerald-500/5"
                    : "border-white/10 bg-card hover:bg-card/80")
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold tracking-tight truncate">
                        {p.title}
                      </h3>
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider " +
                          STATUS_CHIP_CLASS[p.businessStatus]
                        }
                      >
                        {p.businessStatus}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.businessLabel}
                      {p.aspectRatio && p.durationSec ? (
                        <span className="ml-2 opacity-70">
                          · {p.aspectRatio} · {p.durationSec}s
                        </span>
                      ) : null}
                      {p.segmentCount > 0 && p.businessStatus !== "ready" ? (
                        <span className="ml-2 opacity-70">
                          · {p.segmentsSucceeded}/{p.segmentCount} 段已完成
                        </span>
                      ) : null}
                    </p>
                    {p.businessStatus === "ready" && p.finalVideoUrl ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <a
                          href={p.finalVideoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:bg-foreground/90 transition-colors"
                        >
                          预览视频
                        </a>
                        <a
                          href={p.finalVideoUrl}
                          download
                          className="inline-flex items-center rounded-md border border-white/15 bg-card/60 px-3 py-1.5 text-xs hover:bg-card/90 transition-colors"
                        >
                          下载 MP4
                        </a>
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    {p.finalThumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.finalThumbnailUrl}
                        alt=""
                        className="h-16 w-12 rounded object-cover border border-white/10"
                      />
                    ) : null}
                    <span className="mt-2 block text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
