import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import {
  createBatchJob,
  getBatchStatus,
  processBatchTick,
} from "@/lib/services/batch-service";

const createBatchSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.number().int().min(1),
  images: z
    .array(
      z.object({
        id: z.string().min(1).max(300),
        url: z.string().url().refine((url) => /^https?:\/\//i.test(url)),
      }),
    )
    .min(1)
    .max(50),
  requestedCount: z.number().int().min(1).max(200),
  productName: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const parsed = createBatchSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "批量生成参数不合法", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const idempotencyKey =
    req.headers.get("idempotency-key") ?? parsed.data.idempotencyKey;
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "缺少 Idempotency-Key" },
      { status: 400 },
    );
  }

  try {
    const batch = await createBatchJob({
      ...parsed.data,
      userId: guard.session.user.id,
      idempotencyKey,
    });
    // 同一请求内启动首个受控并发 wave；后续由单一 batch status 轮询续跑。
    await processBatchTick(batch.id).catch((error) => {
      console.error("[batch:create] initial tick failed", {
        batchId: batch.id,
        error: (error as Error).message,
      });
    });
    const status = await getBatchStatus(batch.id, guard.session.user.id);
    return NextResponse.json({ batch: status }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 409 },
    );
  }
}
