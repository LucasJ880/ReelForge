import { NextResponse } from "next/server";
import { requireBusinessUser } from "@/lib/api-auth";
import { listAvatars } from "@/lib/video-generation/digital-human/avatar-catalog";
import {
  DIGITAL_HUMAN_SEALED_RESPONSE,
  isDigitalHumanFeatureEnabled,
} from "@/lib/features/digital-human";

/** 预置虚拟数字人目录（不暴露底层 assetUri）。 */
export async function GET() {
  if (!isDigitalHumanFeatureEnabled()) {
    return NextResponse.json(DIGITAL_HUMAN_SEALED_RESPONSE, { status: 404 });
  }
  const guard = await requireBusinessUser();
  if (!guard.ok) return guard.response;

  const avatars = listAvatars().map((a) => ({
    id: a.id,
    name: a.name,
    thumbnailUrl: a.thumbnailUrl ?? null,
    gender: a.gender ?? null,
    style: a.style ?? null,
    description: a.description ?? null,
  }));
  return NextResponse.json({ avatars });
}
