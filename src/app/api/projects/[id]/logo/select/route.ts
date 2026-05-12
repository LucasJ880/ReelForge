import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/api-auth";
import { selectLogo } from "@/lib/services/logo-service";

const bodySchema = z.object({
  generationId: z.string().min(1),
  url: z.string().url(),
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
    const result = await selectLogo({
      deliveryOrderId: id,
      generationId: payload.generationId,
      url: payload.url,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
