import { Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export async function AuthRouteLoading() {
  const copy = getPlatformCopy(await getServerLocale()).auth;

  return (
    <div
      data-route-state="loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="auth-studio-theme studio-canvas flex min-h-screen items-center justify-center bg-background px-6 text-foreground"
    >
      <div className="flex max-w-sm flex-col items-center gap-5 text-center">
        <Logo size={56} />
        <div className="space-y-2">
          <p className="font-heading text-title font-semibold">Aivora</p>
          <p className="text-body text-muted-foreground">{copy.studio}</p>
        </div>
        <div className="flex items-center gap-2 text-meta font-medium text-primary">
          <Loader2
            className="animate-spin motion-reduce:animate-none"
            strokeWidth={1.5}
            aria-hidden
          />
          <span>{copy.preparingStudio}</span>
        </div>
      </div>
    </div>
  );
}
