import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listContentPlans } from "@/lib/services/content-plan-store";
import { readSlides } from "@/lib/services/content-post-render-service";
import {
  PlanTimeline,
  type TimelinePlan,
} from "@/components/content-plan/plan-timeline";

export const dynamic = "force-dynamic";

/**
 * O1 · 本周内容（PRD §3 / M3）。
 *
 * 服务端取数、拼成纯 DTO 交给 client 组件 ——
 * client 组件绝不能自己 import service（会把 Prisma/OpenAI 打进浏览器 bundle）。
 */
export default async function PlanPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/plan");

  const plans = await listContentPlans(session.user.id, 1);
  const latest = plans[0] ?? null;

  const plan: TimelinePlan | null = latest
    ? {
        id: latest.id,
        theme: latest.theme,
        targetAudience: latest.targetAudience,
        corePainPoint: latest.corePainPoint,
        generatedBy: latest.generatedBy,
        posts: latest.posts.map((post) => ({
          id: post.id,
          key: post.key,
          dayOffset: post.dayOffset,
          format: post.format,
          status: post.status,
          copyHook: post.copyHook,
          copyBody: post.copyBody,
          copyCta: post.copyCta,
          hashtags: post.hashtags,
          rationale: post.rationale,
          recipeId: post.recipeId,
          hookType: post.hookType,
          renderedImageUrls: post.renderedImageUrls,
          /// 分屏文字由前端叠在图上 —— 出图模型被明确禁止写字。
          slideOverlays: readSlides(post.slidesJson).map(
            (slide) => slide.overlayText,
          ),
          renderError: post.renderError,
        })),
      }
    : null;

  /// 周一为一周之首，与轨道刻度一致。
  const today = new Date();
  const todayOffset = (today.getDay() + 6) % 7;

  return <PlanTimeline plan={plan} todayOffset={todayOffset} />;
}
