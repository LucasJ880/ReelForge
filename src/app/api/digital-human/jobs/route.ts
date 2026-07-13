import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/api-auth";
import {
  assertQuotaForSession,
  QuotaExceededError,
} from "@/lib/services/quota-service";
import {
  createDigitalHumanAdJob,
  listDigitalHumanAdJobsForUser,
} from "@/lib/services/digital-human-service";
import { getAvatarById } from "@/lib/video-generation/digital-human/avatar-catalog";
import { getVoiceById } from "@/lib/video-generation/digital-human/voice-catalog";
import {
  DIGITAL_HUMAN_SEALED_RESPONSE,
  isDigitalHumanFeatureEnabled,
} from "@/lib/features/digital-human";

const createSchema = z.object({
  avatarId: z.string().min(1),
  voiceId: z.string().min(1),
  storeImageUrls: z.array(z.string().url()).min(1).max(5),
  industry: z.string().min(1).max(120),
  storeDescription: z.string().max(1000).nullish(),
  sellingPoints: z.array(z.string().max(200)).max(8).optional(),
  cta: z.string().max(200).nullish(),
  brandName: z.string().max(80).nullish(),
  durationSec: z.number().int().min(12).max(45).optional(),
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]).optional(),
});

/** 创建一条数字人探店广告生成任务（QUEUED），由外部 runner 异步出片。 */
export async function POST(req: NextRequest) {
  if (!isDigitalHumanFeatureEnabled()) {
    return NextResponse.json(DIGITAL_HUMAN_SEALED_RESPONSE, { status: 404 });
  }
  const guard = await requireBusinessUser();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数有误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const avatar = getAvatarById(data.avatarId);
  if (!avatar) {
    return NextResponse.json({ error: "数字人形象不存在" }, { status: 400 });
  }
  const voice = getVoiceById(data.voiceId);
  if (!voice) {
    return NextResponse.json({ error: "音色不存在" }, { status: 400 });
  }

  try {
    await assertQuotaForSession(guard.session, "DIGITAL_HUMAN_AD", 1, {
      industry: data.industry,
    });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const job = await createDigitalHumanAdJob({
    adminUserId: guard.session.user.id,
    avatarAssetUri: avatar.assetUri,
    voiceType: voice.voiceType,
    voiceResourceId: voice.resourceId,
    storeImageUrls: data.storeImageUrls,
    industry: data.industry,
    storeDescription: data.storeDescription ?? null,
    sellingPoints: data.sellingPoints ?? [],
    cta: data.cta ?? null,
    brandName: data.brandName ?? null,
    durationSec: data.durationSec ?? 28,
    aspectRatio: data.aspectRatio ?? "9:16",
  });

  return NextResponse.json({ ok: true, jobId: job.id });
}

/** 列出当前商家的历史任务。 */
export async function GET() {
  if (!isDigitalHumanFeatureEnabled()) {
    return NextResponse.json(DIGITAL_HUMAN_SEALED_RESPONSE, { status: 404 });
  }
  const guard = await requireBusinessUser();
  if (!guard.ok) return guard.response;
  const jobs = await listDigitalHumanAdJobsForUser(guard.session.user.id);
  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      industry: j.industry,
      outputVideoUrl: j.outputVideoUrl,
      outputThumbnailUrl: j.outputThumbnailUrl,
      createdAt: j.createdAt.toISOString(),
    })),
  });
}
