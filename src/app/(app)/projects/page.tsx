import Link from "next/link";
import { Plus } from "lucide-react";
import { getServerSession } from "next-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/features/page-header";
import { db } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { getServerLocale, getServerTranslator } from "@/i18n/server";
import { readClientBrief } from "@/lib/services/client-project-service";

export const dynamic = "force-dynamic";

/**
 * 客户视角的「项目列表」（PART 6 sidebar restructure 之后的客户主入口）。
 *
 * 数据来源：DeliveryOrder（admin 的「交付单」复用为客户的「项目」实体）。
 * 过滤：当前 session.user.id == DeliveryOrder.createdById；
 *   若没有 session 用户上下文（例如未登录的 demo 浏览），暂时回退到 ALL，
 *   避免空页迷惑首次体验（后续接入权限会改为重定向登录）。
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{ industry?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  const { t } = await getServerTranslator();
  const locale = await getServerLocale();
  const sp = (await searchParams) ?? {};
  const industryParam = Array.isArray(sp.industry)
    ? sp.industry[0]
    : sp.industry;
  const industryFilter = industryParam ? industryParam.trim().toLowerCase() : null;

  const ownerId = session?.user?.id ?? null;
  /// 多取一些以兜住 in-memory industry 过滤后还能显示满 50 条
  const fetchLimit = industryFilter ? 200 : 50;
  const orders = await db.deliveryOrder.findMany({
    where: ownerId ? { createdById: ownerId } : {},
    orderBy: { createdAt: "desc" },
    take: fetchLimit,
    select: {
      id: true,
      title: true,
      clientBrief: true,
      createdAt: true,
      updatedAt: true,
      rounds: {
        select: {
          angles: {
            select: {
              videoBrief: {
                select: {
                  status: true,
                  updatedAt: true,
                  finalThumbnailUrl: true,
                  finalVideo: {
                    select: {
                      thumbnailUrl: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const allItems = orders.map((order) => {
    const brief = readClientBrief(order.clientBrief);
    const briefs = order.rounds
      .flatMap((r) => r.angles.map((a) => a.videoBrief))
      .filter((b): b is NonNullable<typeof b> => b !== null);
    const latestBrief = briefs.length
      ? briefs.reduce((acc, cur) =>
          cur.updatedAt > acc.updatedAt ? cur : acc,
        )
      : null;
    const thumb =
      latestBrief?.finalVideo?.thumbnailUrl ??
      latestBrief?.finalThumbnailUrl ??
      null;
    return {
      id: order.id,
      title: order.title,
      businessName: brief?.businessName ?? null,
      industryKey: brief?.industry ?? null,
      latestBriefStatus: latestBrief?.status ?? null,
      thumbnail: thumb,
      createdAt: order.createdAt,
    };
  });

  /// `clientBrief` 是 JSON 字段，无法直接走 SQL where；先在内存里按 industry 过滤，
  /// 再 cap 到 50。如果未来负载变大可加 industry 投影列 + Prisma where。
  const items = industryFilter
    ? allItems.filter((it) => it.industryKey === industryFilter).slice(0, 50)
    : allItems.slice(0, 50);

  const createCta = (
    <Link href="/wizard/new">
      <Button>
        <Plus className="h-4 w-4" />
        {t("project.create")}
      </Button>
    </Link>
  );

  return (
    <div>
      <PageHeader
        title={t("nav.projects")}
        description={t("project.listSubtitle")}
        actions={createCta}
      />

      {items.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <p className="text-sm text-muted-foreground">{t("project.empty")}</p>
          {createCta}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/projects/${item.id}`}
              className="block"
            >
              <Card className="overflow-hidden p-0 transition-colors hover:ring-1 hover:ring-foreground/20">
                <div className="relative aspect-video w-full overflow-hidden bg-black">
                  {item.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground/70">
                      {t("project.card.noThumbnailHint")}
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <div className="space-y-0.5">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {item.title || t("project.card.untitled")}
                    </p>
                    {item.businessName && (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.businessName}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {item.industryKey && (
                      <span>{t(`industry.${item.industryKey}`)}</span>
                    )}
                    <span>
                      {item.latestBriefStatus
                        ? t(`status.brief.${item.latestBriefStatus}`)
                        : t("project.card.noStatusYet")}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/70">
                    {t("project.card.updatedAt", {
                      time: formatRelativeTime(item.createdAt, locale),
                    })}
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

function formatRelativeTime(date: Date, locale: string): string {
  const now = Date.now();
  const diffSec = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 2629800) return rtf.format(Math.round(diffSec / 604800), "week");
  if (abs < 31557600) return rtf.format(Math.round(diffSec / 2629800), "month");
  return rtf.format(Math.round(diffSec / 31557600), "year");
}
