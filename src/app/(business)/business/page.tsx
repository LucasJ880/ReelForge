import Link from "next/link";
import { Wand2, PackageOpen, Sparkles, TrendingUp } from "lucide-react";
import { getServerTranslator } from "@/i18n/server";

export default async function BusinessHomePage() {
  const { t } = await getServerTranslator();

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("shell.businessHome.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("shell.businessHome.subtitle")}
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/business/create-ad-video"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <Wand2 className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">
              {t("shell.businessHome.createKicker")}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            {t("shell.businessHome.createTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("shell.businessHome.createBody")}
          </p>
        </Link>

        <Link
          href="/business/products"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <PackageOpen className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">
              {t("shell.businessHome.productsKicker")}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            {t("shell.businessHome.productsTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("shell.businessHome.productsBody")}
          </p>
        </Link>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/business/creative-studio"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <Sparkles className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">
              {t("shell.businessHome.studioKicker")}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            {t("shell.businessHome.studioTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("shell.businessHome.studioBody")}
          </p>
        </Link>

        <Link
          href="/business/performance"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <TrendingUp className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">
              {t("shell.businessHome.perfKicker")}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            {t("shell.businessHome.perfTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("shell.businessHome.perfBody")}
          </p>
        </Link>
      </section>
    </div>
  );
}
