import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDigitalHumanDemo } from "@/lib/providers/digital-human";

const demoInputSchema = z.object({
  goal: z.string().min(1).max(240),
  audience: z.string().min(1).max(120),
  footageName: z.string().max(160).optional(),
  audioName: z.string().max(160).optional(),
  avatarName: z.string().max(160).optional(),
  style: z
    .enum(["real-estate", "product-demo", "founder-intro"])
    .default("real-estate"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = demoInputSchema.parse(body);
    const result = await createDigitalHumanDemo(input);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message || "输入格式不正确"
        : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
