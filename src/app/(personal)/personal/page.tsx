import Link from "next/link";
import { Sparkles, Film } from "lucide-react";
import { getServerTranslator } from "@/i18n/server";

export default async function PersonalHomePage() {
  const { t } = await getServerTranslator();

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("shell.personalHome.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("shell.personalHome.subtitle")}
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/personal/create-video"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <Sparkles className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">
              {t("shell.personalHome.createKicker")}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            {t("shell.personalHome.createTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("shell.personalHome.createBody")}
          </p>
        </Link>

        <Link
          href="/personal/videos"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <Film className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">
              {t("shell.personalHome.libraryKicker")}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            {t("shell.personalHome.libraryTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("shell.personalHome.libraryBody")}
          </p>
        </Link>
      </section>
    </div>
  );
}
