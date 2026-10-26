import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import {
  createStoryboardRun,
  findResumableStoryboardRunForUser,
  StoryboardRequestError,
} from "@/lib/video-generation/storyboard-service";
import {
  STORYBOARD_PERSON_REFS_MAX,
  canSubmitStoryboardPersonRefs,
  storyboardPersonRefsMode,
} from "@/lib/video-generation/storyboard-person-refs";

/**
 * Resume entry point: returns the caller's most recent single-video storyboard
 * that is still worth showing after a page refresh (generating, awaiting
 * approval, approved-but-undispatched, or failed), plus the creation context
 * needed to rehydrate the studio form.
 */
export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  try {
    const resume = await findResumableStoryboardRunForUser(guard.session.user.id);
    return NextResponse.json({ ok: true, resume });
  } catch (error) {
    if (error instanceof StoryboardRequestError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }
    console.error("[storyboards:GET]", error);
    return NextResponse.json(
      { ok: false, code: "INTERNAL_ERROR", error: "暂时无法读取故事板。" },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  prompt: z.string().trim().min(8).max(4000),
  durationSec: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  sourceAssetIds: z.array(z.string().min(1).max(200)).max(9).default([]),
  /// 主播参考图（P02-D(s)）：最多 4 张，开关 STORYBOARD_PERSON_REFS 决定谁能传（默认 off → 非空即 400）。
  personAssetIds: z.array(z.string().min(1).max(200)).max(STORYBOARD_PERSON_REFS_MAX).default([]),
  approvalPolicy: z.enum(["MANUAL", "AUTO"]).default("MANUAL"),
  purpose: z.string().trim().min(1).max(200).optional(),
}).strict();

interface StoryboardPostDependencies {
  requireAuth: typeof requireAuth;
  createStoryboardRun: typeof createStoryboardRun;
  personRefsMode: typeof storyboardPersonRefsMode;
}

const defaultPostDependencies: StoryboardPostDependencies = {
  requireAuth,
  createStoryboardRun,
  personRefsMode: storyboardPersonRefsMode,
};

export function createStoryboardPostHandler(
  overrides: Partial<StoryboardPostDependencies> = {},
) {
  const dependencies = { ...defaultPostDependencies, ...overrides };
  return async function storyboardPost(req: NextRequest) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return NextResponse.json(
        { ok: false, code: "IDEMPOTENCY_KEY_REQUIRED", error: "缺少有效的提交标识。" },
        { status: 400 },
      );
    }
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: "VALIDATION_FAILED", error: "故事板参数不完整或格式不正确。" },
        { status: 400 },
      );
    }
    try {
      const run = await dependencies.createStoryboardRun({
        userId: guard.session.user.id,
        idempotencyKey,
        ...parsed.data,
        // 主播参考图的放行由路由按开关 + 角色算好；service 在幂等回放之后才校验，
        // 同一键的旧请求刷新重提不会因为开关关掉而 400。
        personRefsAllowed: canSubmitStoryboardPersonRefs({
          mode: dependencies.personRefsMode(),
          isInternal: isInternalRole(guard.session.user.role),
        }),
        // 创作台直接发起：计入每小时限流（批量内部准备不走这个入口）。
        userInitiated: true,
      });
      return NextResponse.json({ ok: true, run }, { status: 201 });
    } catch (error) {
      if (error instanceof StoryboardRequestError) {
        return NextResponse.json(
          { ok: false, code: error.code, error: error.message },
          { status: error.status },
        );
      }
      console.error("[storyboards:POST]", error);
      return NextResponse.json(
        { ok: false, code: "INTERNAL_ERROR", error: "暂时无法创建故事板。" },
        { status: 500 },
      );
    }
  };
}

export const POST = createStoryboardPostHandler();
