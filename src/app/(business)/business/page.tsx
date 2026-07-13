import Link from "next/link";
import {
  ArrowRight,
  Wand2,
  PackageOpen,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getServerTranslator } from "@/i18n/server";

export default async function BusinessHomePage() {
  const { t } = await getServerTranslator();

  return (
    <div className="space-y-8">
      <BusinessPageHeader
        kicker={t("shell.personaBusiness")}
        title={t("shell.businessHome.title")}
        subtitle={t("shell.businessHome.subtitle")}
      />

      <section
        className="grid gap-4 md:grid-cols-2"
        aria-label={t("shell.businessHome.title")}
      >
        {[
          {
            href: "/business/create-ad-video",
            icon: Wand2,
            kicker: t("shell.businessHome.createKicker"),
            title: t("shell.businessHome.createTitle"),
            body: t("shell.businessHome.createBody"),
          },
          {
            href: "/business/products",
            icon: PackageOpen,
            kicker: t("shell.businessHome.productsKicker"),
            title: t("shell.businessHome.productsTitle"),
            body: t("shell.businessHome.productsBody"),
          },
          {
            href: "/business/creative-studio",
            icon: Sparkles,
            kicker: t("shell.businessHome.studioKicker"),
            title: t("shell.businessHome.studioTitle"),
            body: t("shell.businessHome.studioBody"),
          },
          {
            href: "/business/performance",
            icon: TrendingUp,
            kicker: t("shell.businessHome.perfKicker"),
            title: t("shell.businessHome.perfTitle"),
            body: t("shell.businessHome.perfBody"),
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.href} className="h-full" size="sm">
              <CardContent className="h-full pt-2">
                <Link
                  href={item.href}
                  className="flex h-full min-w-0 flex-col gap-4 rounded-(--radius-md) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <div className="flex items-center gap-3 text-meta font-medium text-muted-foreground">
                    <Icon className="size-5" strokeWidth={1.5} aria-hidden />
                    <span>{item.kicker}</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="font-heading text-subhead font-normal">
                      {item.title}
                    </h2>
                    <p className="text-body text-muted-foreground">{item.body}</p>
                  </div>
                  <ArrowRight
                    className="mt-auto size-4 text-primary"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
