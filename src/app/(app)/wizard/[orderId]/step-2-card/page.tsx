import { notFound } from "next/navigation";
import {
  listCreativeEvidenceCards,
  recommendCreativeCards,
} from "@/lib/services/creative-evidence-service";
import { getClientProject } from "@/lib/services/client-project-service";
import { CardPickerClient } from "./card-picker-client";

export default async function WizardStep2Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const project = await getClientProject(orderId);
  if (!project || !project.brief) notFound();
  const { brief } = project;

  /// 同时拉两路：推荐 + PUBLISHED 全量列表，便于客户对比
  const [{ items: published }, recommended] = await Promise.all([
    listCreativeEvidenceCards({ status: "PUBLISHED", limit: 30 }),
    recommendCreativeCards({
      industry: brief.industry,
      objective: brief.objective,
      platform: (brief.targetPlatforms[0] === "tiktok" ||
      brief.targetPlatforms[0] === "instagram_reels" ||
      brief.targetPlatforms[0] === "youtube_shorts" ||
      brief.targetPlatforms[0] === "facebook" ||
      brief.targetPlatforms[0] === "mixed"
        ? brief.targetPlatforms[0]
        : "tiktok") as "tiktok" | "instagram_reels" | "youtube_shorts" | "facebook" | "mixed",
      limit: 6,
    }),
  ]);

  /// 把推荐分映射到 card 详情，保留排序
  const cardById = new Map(published.map((c) => [c.id, c]));
  const recommendedCards = recommended
    .map((r) => {
      const card = cardById.get(r.cardId);
      if (!card) return null;
      return { ...card, _recScore: r.score, _recReasons: r.reasons };
    })
    .filter((c): c is NonNullable<typeof c> => !!c);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          Step 2 · 选一张创意证据卡
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          这些卡片会作为「结构灵感」喂给 AI 写脚本和分镜，但不会复制原视频字幕、镜头或配音。
        </p>
      </header>

      <CardPickerClient
        orderId={orderId}
        currentSelectedSlug={brief.selectedCardSlug ?? null}
        recommended={recommendedCards}
        published={published}
      />
    </div>
  );
}
