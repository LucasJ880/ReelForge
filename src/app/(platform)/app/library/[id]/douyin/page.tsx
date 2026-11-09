import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { QuoteHeader } from "@/components/exchange/quote-header";
import { StatusTick } from "@/components/exchange/status-tick";
import { DouyinPublishKit } from "@/components/library/douyin-publish-kit";
import { getDouyinKitCopy } from "@/i18n/douyin-kit-copy";
import { getServerLocale } from "@/i18n/server";
import { brandEndCardEntryEnabledFor } from "@/lib/brand/brand-end-card-policy";
import { isDouyinMatrixAccount } from "@/lib/brand/douyin-matrix-access";
import { DOUYIN_PLATFORM } from "@/lib/contracts/douyin-publish-kit";
import { libraryDisplayTitle } from "@/lib/library/display-title";
import {
  loadDouyinKitContext,
  toKitRegistration,
} from "@/lib/services/douyin-publish-kit-service";
import {
  getActivePlatformPublish,
  PublishRegistrationUnavailableError,
} from "@/lib/services/publish-service";

export const dynamic = "force-dynamic";

/**
 * 抖音发布包（成品库 → 成片 → 抖音发布包）：一条已成片的单条视频发抖音要用的全部东西。
 * 左边是原成片，右边三段：标题正文话题 → 导出素材（发布版成片 + 封面）→ 发布登记。
 * 只对本人的成片开放（样片、还没成片的都 404）。矩阵账号判定在这里做完，面板只拿布尔值。
 */
export default async function DouyinPublishKitPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  if (!session?.user?.id) redirect(`/login?from=/app/library/${id}/douyin`);
  const context = await loadDouyinKitContext(session.user.id, id);
  if (!context) notFound();
  const locale = await getServerLocale();
  const copy = getDouyinKitCopy(locale);
  const matrixAccount = await isDouyinMatrixAccount(session.user.id);
  const endCard = brandEndCardEntryEnabledFor({ matrixAccount });

  /// 迁移没跑（列不存在）时登记停用，文案与素材照常——不让一个缺列把整页打成 500
  let registrationAvailable = true;
  let registration = null;
  try {
    const row = await getActivePlatformPublish(context.briefId, DOUYIN_PLATFORM);
    registration = row ? toKitRegistration(row) : null;
  } catch (err) {
    if (!(err instanceof PublishRegistrationUnavailableError)) throw err;
    registrationAvailable = false;
  }

  return (
    <div className="x-stack min-w-0">
      <Button render={<Link href={`/app/library/${id}`} />} variant="ghost" size="sm" className="self-start">
        <ArrowLeft aria-hidden />
        {copy.back}
      </Button>
      <QuoteHeader
        title={copy.title}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusTick entity="publish" state={registration ? "logged" : "unlogged"} locale={locale} />
            <span className="min-w-0 break-words">{libraryDisplayTitle(context.title)}</span>
          </span>
        }
        subtitle={copy.subtitle}
        primaryAction={null}
        readingsLabel={copy.readingsLabel}
        readings={[
          {
            label: copy.readingAccount,
            value: registration?.accountLabel ?? "—",
            caption: registration ? undefined : copy.readingAccountEmpty,
            tone: registration ? "filled" : "neutral",
          },
          {
            label: copy.readingEndCard,
            value: endCard ? copy.endCardOn : copy.endCardOff,
            caption: endCard ? copy.endCardOnHint : copy.endCardOffHint,
          },
        ]}
        scope={copy.scope.replace("{id}", context.orderId)}
      />

      <section className="grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <div className="x-panel flex min-w-0 justify-center p-4 lg:sticky lg:top-4">
          <video
            controls
            preload="metadata"
            poster={context.thumbnailUrl ?? undefined}
            src={context.cleanVideoUrl}
            className="max-h-[60vh] w-auto max-w-full rounded-(--radius-md)"
          />
        </div>
        <DouyinPublishKit
          orderId={context.orderId}
          locale={locale}
          copy={copy}
          matrixAccount={endCard}
          registration={registration}
          registrationAvailable={registrationAvailable}
        />
      </section>
    </div>
  );
}
