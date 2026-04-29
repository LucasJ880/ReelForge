import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { preprocessRawAsset } from "@/lib/services/asset-service";
import { preprocessRawAssetSchema } from "@/lib/validators";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = preprocessRawAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const asset = await preprocessRawAsset(id, parsed.data);
    return NextResponse.json(asset);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
