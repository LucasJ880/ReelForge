import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/features/page-header";
import { db } from "@/lib/db";
import { getServerTranslator } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * 视频库 —— 用户视角的成片浏览页（PART 6）。
 *
 * 数据来源：
 * - 多段流：FinalVideo.status=READY 的记录
 * - 旧单段流（含 Sunny Shutter）：VideoBrief.finalVideoUrl 非空 的记录
 *
 * 主要展示 finalVideoUrl + thumbnail，点击进入对应项目详情。
 */
export default async function VideosPage() {
  const { t } = await getServerTranslator();

  const briefs = await db.videoBrief.findMany({
    where: {
      OR: [
        { finalVideoUrl: { not: null } },
        { finalVideo: { is: { status: "READY" } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      finalVideoUrl: true,
      finalThumbnailUrl: true,
      targetDurationSec: true,
      finalVideo: {
        select: {
          stitchedVideoUrl: true,
          thumbnailUrl: true,
          status: true,
          targetDurationSec: true,
        },
      },
      contentAngle: {
        select: {
          title: true,
          round: {
            select: {
              deliveryOrder: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  });

  const items = briefs
    .map((b) => {
      const url = b.finalVideo?.stitchedVideoUrl ?? b.finalVideoUrl;
      const thumb = b.finalVideo?.thumbnailUrl ?? b.finalThumbnailUrl;
      const duration = b.finalVideo?.targetDurationSec ?? b.targetDurationSec;
      if (!url) return null;
      return {
        briefId: b.id,
        url,
        thumb,
        duration,
        title: b.contentAngle.title,
        orderId: b.contentAngle.round.deliveryOrder.id,
        orderTitle: b.contentAngle.round.deliveryOrder.title,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div>
      <PageHeader
        title={t("nav.videos")}
        description={t("video.subtitle")}
      />

      {items.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {t("video.libraryEmpty")}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.briefId}
              href={`/internal/orders/${item.orderId}`}
              className="block"
            >
              <Card className="overflow-hidden transition-colors hover:ring-1 hover:ring-foreground/20">
                <div className="relative aspect-9/16 w-full overflow-hidden bg-black">
                  {item.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumb}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <video
                      src={item.url}
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  )}
                  <div className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    {item.duration}s
                  </div>
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.orderTitle}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.title}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
