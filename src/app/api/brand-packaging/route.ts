/**
 * POST /api/brand-packaging — 「➕ 品牌封装」：对一条干净成片可选叠加
 * logo 角标 + 名片尾卡（自动裁掉模型假尾卡后拼接），返回 branded 成片。
 *
 * 产品决策（2026-07-20）：封装是 optional 的、按视频粒度选择；
 * SunnyShutter 走锁死 profile，其他客户传自己的 logo + 联系方式。
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { applyClientBrandPackaging } from "@/lib/video-generation/brand-packaging-service";
import {
  findWorkspaceBrandPackageForUser,
  listWorkspaceBrandPackagesForUser,
  upsertWorkspaceBrandPackageForUser,
} from "@/lib/services/workspace-brand-package-service";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  /** 干净原片 URL（Blob / 成片库地址）。与 videoJobId / briefId 三选一。 */
  sourceVideoUrl: z.string().url().nullish(),
  /** 批量视频：按 VideoJob 封装并把 brandedVideoUrl 落库。 */
  videoJobId: z.string().min(1).nullish(),
  /** 单条创作：按 VideoBrief 封装并把 brandedVideoUrl 落库。 */
  briefId: z.string().min(1).nullish(),
  brandPackageId: z.string().min(1).nullish(),
  clientProfileId: z.literal("sunnyshutter").nullish(),
  custom: z
    .object({
      brandName: z.string().trim().min(1).max(120),
      logoUrl: z.string().url(),
      phone: z.string().trim().max(40).nullish(),
      addressLines: z.array(z.string().trim().max(160)).max(3).optional(),
      slogan: z.string().trim().max(160).nullish(),
      cta: z.string().trim().max(160).nullish(),
      website: z.string().trim().max(160).nullish(),
    })
    .nullish(),
  includeLogo: z.boolean().optional(),
  includeEndCard: z.boolean().optional(),
  aspectRatio: z.enum(["9:16", "16:9"]).optional(),
});

const packageSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  brandName: z.string().trim().min(1).max(120),
  slogan: z.string().trim().max(160).nullish(),
  cta: z.string().trim().max(160).nullish(),
  contactLines: z.array(z.string().trim().min(1).max(160)).max(3).optional(),
  website: z.string().trim().max(160).nullish(),
  logoAssetId: z.string().min(1),
  endCardAssetId: z.string().min(1).nullish(),
  isDefault: z.boolean().optional(),
}).strict();

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    packages: await listWorkspaceBrandPackagesForUser(session.user.id),
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = packageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid brand package" }, { status: 400 });
  }
  try {
    const brandPackage = await upsertWorkspaceBrandPackageForUser({
      userId: session.user.id,
      ...parsed.data,
    });
    return NextResponse.json({ brandPackage });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "brand package failed" },
      { status: 400 },
    );
  }
}

async function downloadTo(dir: string, name: string, url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed ${response.status}: ${url.slice(0, 120)}`);
  }
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const selectedPackage = body.brandPackageId
    ? await findWorkspaceBrandPackageForUser(body.brandPackageId, session.user.id)
    : null;
  if (body.brandPackageId && !selectedPackage) {
    return NextResponse.json({ error: "brand package not found" }, { status: 404 });
  }
  if (!selectedPackage && !body.clientProfileId && !body.custom) {
    return NextResponse.json(
      { error: "clientProfileId or custom brand info required" },
      { status: 400 },
    );
  }
  const targetCount = [body.sourceVideoUrl, body.videoJobId, body.briefId].filter(
    Boolean,
  ).length;
  if (targetCount !== 1) {
    return NextResponse.json(
      { error: "exactly one of sourceVideoUrl / videoJobId / briefId required" },
      { status: 400 },
    );
  }

  /// 解析封装对象：videoJobId / briefId 需校验归属并在成功后落库。
  let sourceVideoUrl = body.sourceVideoUrl ?? null;
  let persist: (brandedUrl: string) => Promise<void> = async () => {};
  if (body.videoJobId) {
    const job = await db.videoJob.findFirst({
      where: { id: body.videoJobId, batchJob: { userId: session.user.id } },
      select: { id: true, status: true, outputVideoUrl: true },
    });
    if (!job) {
      return NextResponse.json({ error: "video job not found" }, { status: 404 });
    }
    if (job.status !== "SUCCEEDED" || !job.outputVideoUrl) {
      return NextResponse.json(
        { error: "video job has no finished output yet" },
        { status: 409 },
      );
    }
    sourceVideoUrl = job.outputVideoUrl;
    persist = async (brandedUrl) => {
      await db.videoJob.update({
        where: { id: job.id },
        data: { brandedVideoUrl: brandedUrl, brandedAt: new Date() },
      });
    };
  } else if (body.briefId) {
    const brief = await db.videoBrief.findFirst({
      where: {
        id: body.briefId,
        contentAngle: {
          round: { deliveryOrder: { createdById: session.user.id } },
        },
      },
      select: {
        id: true,
        finalVideoUrl: true,
        finalVideo: { select: { stitchedVideoUrl: true } },
      },
    });
    if (!brief) {
      return NextResponse.json({ error: "brief not found" }, { status: 404 });
    }
    const cleanUrl = brief.finalVideo?.stitchedVideoUrl ?? brief.finalVideoUrl;
    if (!cleanUrl) {
      return NextResponse.json(
        { error: "brief has no finished video yet" },
        { status: 409 },
      );
    }
    sourceVideoUrl = cleanUrl;
    persist = async (brandedUrl) => {
      await db.videoBrief.update({
        where: { id: brief.id },
        data: { brandedVideoUrl: brandedUrl, brandedAt: new Date() },
      });
    };
  }

  try {
    const workDir = mkdtempSync(join(tmpdir(), "brand-pack-"));
    const sourcePath = await downloadTo(workDir, "source.mp4", sourceVideoUrl!);
    const packageLogoUrl = selectedPackage?.logoAsset.url ?? body.custom?.logoUrl ?? null;
    const logoPath = packageLogoUrl
      ? await downloadTo(workDir, "logo.png", packageLogoUrl)
      : null;
    const selectedSunny = selectedPackage?.clientProfileId === "sunnyshutter";

    const result = await applyClientBrandPackaging({
      sourceVideoPath: sourcePath,
      clientProfileId: selectedSunny ? "sunnyshutter" : (body.clientProfileId ?? null),
      custom: selectedPackage && !selectedSunny
        ? {
            logoPath: logoPath!,
            card: {
              brandName: selectedPackage.brandName,
              slogan: selectedPackage.slogan,
              cta: selectedPackage.cta,
              phone: selectedPackage.contactLines[0] ?? null,
              addressLines: selectedPackage.contactLines.slice(1),
              website: selectedPackage.website,
              endCardStillUrl: selectedPackage.endCardAsset?.url ?? null,
            },
          }
        : body.custom
        ? {
            logoPath: logoPath!,
            card: {
              brandName: body.custom.brandName,
              slogan: body.custom.slogan ?? null,
              cta: body.custom.cta ?? null,
              phone: body.custom.phone ?? null,
              addressLines: body.custom.addressLines ?? [],
              website: body.custom.website ?? null,
            },
          }
        : undefined,
      options: {
        includeLogo: body.includeLogo ?? true,
        includeEndCard: body.includeEndCard ?? true,
        aspectRatio: body.aspectRatio ?? "9:16",
      },
      outputDir: workDir,
      outputId: `brand-${Date.now().toString(36)}`,
    });

    await persist(result.blobUrl);

    return NextResponse.json({
      brandedUrl: result.blobUrl,
      steps: result.steps,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error("[brand-packaging] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message.slice(0, 300) : "brand packaging failed",
      },
      { status: 500 },
    );
  }
}
