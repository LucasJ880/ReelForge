import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/api-auth";
import {
  LOGO_STYLE_KEYS,
  generateLogoCandidates,
} from "@/lib/services/logo-service";

const bodySchema = z.object({
  businessName: z.string().min(1).max(120),
  industry: z.string().max(120).optional().nullable(),
  style: z.enum(LOGO_STYLE_KEYS).optional().nullable(),
  colors: z.string().max(120).optional().nullable(),
  slogan: z.string().max(200).optional().nullable(),
  iconIdea: z.string().max(200).optional().nullable(),
  language: z.string().max(10).optional().nullable(),
  count: z.number().int().min(1).max(4).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "请求参数无效", detail: (err as Error).message },
      { status: 400 },
    );
  }

  try {
    const result = await generateLogoCandidates({
      deliveryOrderId: id,
      businessName: payload.businessName,
      industry: payload.industry ?? null,
      style: payload.style ?? null,
      colors: payload.colors ?? null,
      slogan: payload.slogan ?? null,
      iconIdea: payload.iconIdea ?? null,
      language: payload.language ?? null,
      count: payload.count,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
