import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const waitlistSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名。").max(160, "姓名过长。"),
  businessType: z
    .string()
    .trim()
    .min(1, "请填写业务类型。")
    .max(160, "业务类型过长。"),
  monthlyVolume: z.enum(["1-10", "11-50", "51-200", "200+"]),
  painPoint: z
    .string()
    .trim()
    .min(1, "请填写当前视频制作痛点。")
    .max(800, "痛点描述过长。"),
  email: z.string().trim().email("请填写有效邮箱。").max(240, "邮箱过长。"),
});

export async function POST(req: NextRequest) {
  try {
    const input = waitlistSchema.parse(await req.json());
    await db.realFootageDemoLead.create({
      data: {
        ...input,
        source: "demo/real-footage-ads",
      },
    });

    return NextResponse.json({
      ok: true,
      message: "已收到，我们会联系你安排 demo。",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || "表单信息不完整。" },
        { status: 400 },
      );
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        { error: "暂时无法保存提交，请稍后重试或直接联系我们。" },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: "提交暂时不可用，请稍后重试。" },
      { status: 503 },
    );
  }
}
