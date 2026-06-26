import { NextRequest, NextResponse } from "next/server";
import { requireBusinessUser } from "@/lib/api-auth";
import { getDigitalHumanAdJobForUser } from "@/lib/services/digital-human-service";

/** 查询单条任务进度/结果（前端轮询用，已 scope 到当前商家）。 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireBusinessUser();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const isInternal =
    guard.session.user.userType === "OPERATOR" ||
    guard.session.user.userType === "SUPER_ADMIN";
  const job = await getDigitalHumanAdJobForUser(id, guard.session.user.id, isInternal);
  if (!job) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ job });
}
