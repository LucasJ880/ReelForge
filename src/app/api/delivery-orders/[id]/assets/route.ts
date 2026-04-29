import { NextRequest, NextResponse } from "next/server";
import { RawAssetType } from "@prisma/client";
import { requireOperator } from "@/lib/api-auth";
import {
  listRawAssets,
  preprocessDeliveryOrderAssets,
  registerRawAsset,
} from "@/lib/services/asset-service";
import {
  preprocessRawAssetSchema,
  registerRawAssetSchema,
} from "@/lib/validators";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const items = await listRawAssets(id);
  return NextResponse.json({ items });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body.action === "preprocess_all") {
    const parsed = preprocessRawAssetSchema.safeParse(body.options ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "参数错误", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    try {
      const items = await preprocessDeliveryOrderAssets(id, parsed.data);
      return NextResponse.json({ items });
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 500 },
      );
    }
  }

  const parsed = registerRawAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const asset = await registerRawAsset({
      deliveryOrderId: id,
      type: RawAssetType[parsed.data.type],
      name: parsed.data.name,
      url: parsed.data.url,
      mimeType: parsed.data.mimeType,
      durationMs: parsed.data.durationMs,
      width: parsed.data.width,
      height: parsed.data.height,
      fileSizeBytes: parsed.data.fileSizeBytes,
      checksum: parsed.data.checksum,
      notes: parsed.data.notes,
      tags: parsed.data.tags,
      metadata: parsed.data.metadata,
    });
    return NextResponse.json(asset);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
