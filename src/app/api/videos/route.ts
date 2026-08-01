import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { videosApiQuerySchema } from "@/lib/contracts/videos-api";
import { listSyncableVideos } from "@/lib/services/videos-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/videos` —— 青砚 `aivora-sync` 拉取成片（PRD §9，M0）。
 *
 * 机器鉴权 only：这里没有会话回退。与 `/api/internal/*` 不同，本接口面向的是
 * 外部系统的定时任务，不存在「操作员在本地手点一下」的用法；开一个会话回退
 * 只会多一条把客户成片暴露出去的路径。
 *
 * 只读。不写库、不触发生成、不返回任何凭据。
 */
export async function GET(req: NextRequest) {
  const machineFailure = machineAuthFailure(req);
  if (machineFailure) return machineFailure;

  const parsed = videosApiQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const payload = await listSyncableVideos(parsed.data);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
