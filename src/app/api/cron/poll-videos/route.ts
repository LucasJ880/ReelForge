import { NextRequest, NextResponse } from "next/server";
import { pollRunningJobs } from "@/lib/services/video-service";

/**
 * Vercel Cron 调用：每 1-5 分钟扫描一次正在运行的 VideoJob，
 * 查询 Seedance 状态并更新。
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (process.env.CRON_SECRET) {
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const result = await pollRunningJobs(30);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export const POST = GET;
