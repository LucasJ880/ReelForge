import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { QuoteHeader } from "@/components/exchange/quote-header";
import { OnboardingExit, WelcomeSteps } from "@/components/onboarding/welcome-steps";
import { authOptions } from "@/lib/auth";
import { loadOnboardingState } from "@/lib/services/onboarding-service";
import { getOnboardingCopy } from "@/i18n/onboarding-copy";
import { getServerLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: `${getOnboardingCopy(await getServerLocale()).welcome.title} · Aivora` };
}

/**
 * 上手向导（1025 整合轮 C1）：注册后的第一站，也是「第一周清单」。
 * 行情头的读数全是真实状态（零就写零）：几步做完、本月额度、品牌包、询盘页；
 * 四步的表单在客户端小岛里，保存后 router.refresh() 让这里的读数跟着变。
 */
export default async function WelcomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/welcome");
  const locale = await getServerLocale();
  const copy = getOnboardingCopy(locale).welcome;
  const state = await loadOnboardingState(session.user.id, locale);
  /// 2026-10-28 询盘入口下线：上手只算三步（生意、品牌、第一条视频）
  const done = [state.steps.business, state.steps.brand, state.steps.video].filter((status) => status === "done").length;

  return (
    <div className="x-stack min-w-0" data-testid="welcome-page">
      <QuoteHeader
        title={copy.title}
        subtitle={copy.subtitle}
        primaryAction={null}
        secondaryActions={<OnboardingExit mode="skip" locale={locale} />}
        readingsLabel={copy.readingsLabel}
        readings={[
          { label: copy.readingSteps, value: `${done} / 3`, tone: done === 3 ? "filled" : "neutral" },
          {
            label: copy.readingQuota,
            value: `${state.quota.used} / ${state.quota.limit}`,
            caption: copy.readingQuotaCaption,
          },
          { label: copy.readingBrand, value: state.brandPackageName ?? copy.readingBrandNone },
        ]}
        scope={copy.scope}
      />
      <WelcomeSteps state={state} locale={locale} />
    </div>
  );
}
