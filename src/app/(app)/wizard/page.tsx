import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireWizardPage } from "@/lib/api-auth";
import { readClientBrief } from "@/lib/services/client-project-service";
import { getServerTranslator } from "@/i18n/server";

export default async function WizardIndexPage() {
  await requireWizardPage();
  const { t } = await getServerTranslator();
  const orders = await db.deliveryOrder.findMany({
    // 避免使用字面量 null（Prisma 6 已废弃且语义为 JSON null 字面量）
    where: { NOT: { clientBrief: { equals: Prisma.DbNull } } },
    orderBy: { updatedAt: "desc" },
    take: 30,
    include: { selectedCreativeCard: { select: { title: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t("wizard.index.pageTitle")}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t("wizard.index.pageSubtitle")}
          </p>
        </div>
        <Link href="/wizard/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" /> {t("wizard.index.newButton")}
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("wizard.index.existingTitle", { count: orders.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {orders.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("wizard.index.empty")}
            </p>
          ) : (
            orders.map((o) => {
              const brief = readClientBrief(o.clientBrief);
              return (
                <Link
                  key={o.id}
                  href={`/wizard/${o.id}`}
                  className="block rounded-md border border-white/10 bg-card/40 p-3 hover:border-white/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-sm font-medium">{o.title}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {brief
                          ? [
                              safeT(t, `industry.${brief.industry}`, brief.industry),
                              safeT(
                                t,
                                `objective.${brief.objective}`,
                                brief.objective,
                              ),
                              `${brief.videoLengthSec}s`,
                              brief.targetPlatforms
                                .map((p) => safeT(t, `platform.${p}`, p))
                                .join(", "),
                            ].join(" · ")
                          : t("wizard.index.briefIncomplete")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {o.selectedCreativeCard?.title && (
                        <Badge className="bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-[10px]">
                          {o.selectedCreativeCard.title}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] border-white/20">
                        {o.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(o.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Translator 缺 key 时返回 key 自身；这里在那种情况下回退到 fallback。
 */
function safeT(
  t: (key: string, params?: Record<string, string | number>) => string,
  key: string,
  fallback: string,
): string {
  const value = t(key);
  return value === key ? fallback : value;
}
