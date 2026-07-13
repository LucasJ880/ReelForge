import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import {
  isInternalRacingUser,
  recordRacingMetrics,
} from "@/lib/services/racing-service";

const racingMetricsSchema = z.object({
  videoBriefId: z.string().min(1),
  platform: z.enum(["tiktok", "instagram_reels", "youtube_shorts", "facebook"]),
  externalPostId: z.string().trim().min(1).max(200),
  publishUrl: z.string().url().max(2000).nullable().optional(),
  windowHours: z.union([z.literal(12), z.literal(24), z.literal(48)]),
  metrics: z.object({
    views: z.number().int().min(0).optional(),
    completion_rate: z.number().min(0).max(1).optional(),
    retention_3s: z.number().min(0).max(1).optional(),
    shares: z.number().int().min(0).optional(),
    saves: z.number().int().min(0).optional(),
    likes: z.number().int().min(0).optional(),
    comments: z.number().int().min(0).optional(),
  }).refine((metrics) => Object.values(metrics).some((value) => value != null), {
    message: "至少填写一项指标",
  }),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const parsed = racingMetricsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "指标参数无效", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { id } = await params;
  try {
    const result = await recordRacingMetrics({
      access: {
        userId: guard.session.user.id!,
        canViewAll: isInternalRacingUser(guard.session.user.userType),
      },
      roundId: id,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
