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
import { applyClientBrandPackaging } from "@/lib/video-generation/brand-packaging-service";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  /** 干净原片 URL（Blob / 成片库地址） */
  sourceVideoUrl: z.string().url(),
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
  if (!body.clientProfileId && !body.custom) {
    return NextResponse.json(
      { error: "clientProfileId or custom brand info required" },
      { status: 400 },
    );
  }

  try {
    const workDir = mkdtempSync(join(tmpdir(), "brand-pack-"));
    const sourcePath = await downloadTo(workDir, "source.mp4", body.sourceVideoUrl);
    const logoPath = body.custom
      ? await downloadTo(workDir, "logo.png", body.custom.logoUrl)
      : null;

    const result = await applyClientBrandPackaging({
      sourceVideoPath: sourcePath,
      clientProfileId: body.clientProfileId ?? null,
      custom: body.custom
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
