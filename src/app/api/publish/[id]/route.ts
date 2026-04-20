import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import {
  confirmPublished,
  failPublish,
  markDownloaded,
  submitExternalPost,
  tryTransitionRoundToLive,
} from "@/lib/services/publish-service";
import { submitPostSchema } from "@/lib/validators";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    switch (body.action) {
      case "download": {
        const r = await markDownloaded(id);
        return NextResponse.json(r);
      }
      case "submit": {
        const parsed = submitPostSchema.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json(
            { error: "参数错误", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const r = await submitExternalPost(id, {
          publishedById: guard.session.user.id,
          externalPostId: parsed.data.externalPostId,
          publishUrl: parsed.data.publishUrl,
          operatorNote: parsed.data.operatorNote,
        });
        return NextResponse.json(r);
      }
      case "confirm": {
        const r = await confirmPublished(id);
        await tryTransitionRoundToLive(id);
        return NextResponse.json(r);
      }
      case "fail": {
        const r = await failPublish(id, body.reason ?? "");
        return NextResponse.json(r);
      }
      default:
        return NextResponse.json(
          { error: "不支持的 action" },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
