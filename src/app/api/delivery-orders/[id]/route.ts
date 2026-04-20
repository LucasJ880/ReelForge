import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import {
  getDeliveryOrderDetail,
} from "@/lib/services/order-service";
import { cancelDeliveryOrder, finalizeDeliveryOrder } from "@/lib/services/round-service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const order = await getDeliveryOrderDetail(id);
  if (!order) {
    return NextResponse.json({ error: "交付单不存在" }, { status: 404 });
  }
  return NextResponse.json(order);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body.action === "finalize") {
    const updated = await finalizeDeliveryOrder(id, body.reason ?? "");
    return NextResponse.json(updated);
  }
  if (body.action === "cancel") {
    const updated = await cancelDeliveryOrder(id, body.reason ?? "");
    return NextResponse.json(updated);
  }
  return NextResponse.json({ error: "不支持的 action" }, { status: 400 });
}
