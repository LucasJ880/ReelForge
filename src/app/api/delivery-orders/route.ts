import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import {
  createDeliveryOrder,
  listDeliveryOrders,
} from "@/lib/services/order-service";
import { createDeliveryOrderSchema } from "@/lib/validators";

export async function GET(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const skip = Number(url.searchParams.get("skip") ?? 0);
  const take = Number(url.searchParams.get("take") ?? 50);
  const result = await listDeliveryOrders({ status, skip, take });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const body = await req.json().catch(() => null);
  const parsed = createDeliveryOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const order = await createDeliveryOrder({
    ...parsed.data,
    createdById: guard.session.user.id,
  });
  return NextResponse.json(order, { status: 201 });
}
