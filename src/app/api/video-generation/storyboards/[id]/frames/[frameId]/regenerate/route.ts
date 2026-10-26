import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import {
  regenerateStoryboardFrame,
  StoryboardRequestError,
} from "@/lib/video-generation/storyboard-service";
import {
  STORYBOARD_FRAME_DIRECTION_MAX,
  STORYBOARD_FRAME_SOURCE_ASSETS_MAX,
} from "@/lib/video-generation/storyboard-frame-inputs";

/// 空 body 等价于 {}：旧客户端与批量路径不带 body 也照常重做。
const regenerateSchema = z.object({
  promptOverride: z.string().trim().max(STORYBOARD_FRAME_DIRECTION_MAX).optional(),
  /// 归属在 service 里按本人素材校验（不属于本人 → 404）。
  sourceAssetIds: z.array(z.string().min(1).max(200)).max(STORYBOARD_FRAME_SOURCE_ASSETS_MAX).optional(),
}).strict();

interface RegeneratePostDependencies {
  requireAuth: typeof requireAuth;
  regenerateStoryboardFrame: typeof regenerateStoryboardFrame;
}

const defaultDependencies: RegeneratePostDependencies = {
  requireAuth,
  regenerateStoryboardFrame,
};

async function readBody(req: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await req.text().catch(() => "");
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function createFrameRegeneratePostHandler(
  overrides: Partial<RegeneratePostDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function frameRegeneratePost(
    req: NextRequest,
    context: { params: Promise<{ id: string; frameId: string }> },
  ) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;
    const { id, frameId } = await context.params;
    const body = await readBody(req);
    const parsed = body.ok ? regenerateSchema.safeParse(body.value) : null;
    if (!parsed?.success) {
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION_FAILED",
          error: `补充要求最多 ${STORYBOARD_FRAME_DIRECTION_MAX} 字，参考图最多 ${STORYBOARD_FRAME_SOURCE_ASSETS_MAX} 张。`,
        },
        { status: 400 },
      );
    }
    try {
      const run = await dependencies.regenerateStoryboardFrame({
        userId: guard.session.user.id,
        runId: id,
        frameId,
        promptOverride: parsed.data.promptOverride || undefined,
        sourceAssetIds: parsed.data.sourceAssetIds,
        // 用户点「重做这一帧」：计入每小时限流；单帧另有重做次数上限。
        userInitiated: true,
      });
      return NextResponse.json({ ok: true, run });
    } catch (error) {
      if (error instanceof StoryboardRequestError) {
        return NextResponse.json(
          { ok: false, code: error.code, error: error.message },
          { status: error.status },
        );
      }
      throw error;
    }
  };
}

export const POST = createFrameRegeneratePostHandler();
