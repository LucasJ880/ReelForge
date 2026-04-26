import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeDemoReferenceVideo } from "@/lib/services/demo-video-analysis-service";

export const maxDuration = 60;

const demoInputSchema = z.object({
  tiktokUrl: z.string().url().max(500),
  clientIndustry: z.string().min(1).max(120),
  clientOffer: z.string().min(1).max(220),
  targetAudience: z.string().min(1).max(160),
  tone: z.enum(["premium", "friendly", "expert", "bold"]).default("premium"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = demoInputSchema.parse(body);
    const result = await analyzeDemoReferenceVideo(input);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message || "输入格式不正确"
        : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
