import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { productAnchorView } from "@/lib/contracts/product-anchor-api";
import {
  getOwnedProductAnchor,
  runCutout,
} from "@/lib/services/product-anchor-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/// 演示账号不跑付费生成（铁律 #4）：抠图按张计费。
const DEMO_EMAIL = "demo@aivora.app";

interface ProductAnchorRetryDependencies {
  requireAuth: typeof requireAuth;
  getOwnedProductAnchor: typeof getOwnedProductAnchor;
  runCutout: typeof runCutout;
}

const defaultRetryDependencies: ProductAnchorRetryDependencies = {
  requireAuth,
  getOwnedProductAnchor,
  runCutout,
};

/**
 * 锚点抠图续跑：
 *  - FAILED（如原图临时取不到、上游 5xx）→ 原地重跑，不用重新上传；
 *  - PENDING_CUTOUT（抠图 key 后配的场景）→ 商家自己就能续上，
 *    这是服务层 processPendingAnchors 承诺的「不需要重新提交」在界面上的入口。
 * READY 短路返回：重复点不重复扣抠图费。
 */
export function createProductAnchorRetryHandler(
  overrides: Partial<ProductAnchorRetryDependencies> = {},
) {
  const dependencies = { ...defaultRetryDependencies, ...overrides };
  return async function productAnchorRetry(
    _req: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;

    if (guard.session.user.email === DEMO_EMAIL) {
      return NextResponse.json(
        {
          ok: false,
          code: "DEMO_BLOCKED",
          error: "演示账号不能提交付费抠图。",
        },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const anchor = await dependencies.getOwnedProductAnchor(
      guard.session.user.id,
      id,
    );
    if (!anchor) {
      return NextResponse.json(
        {
          ok: false,
          code: "RESOURCE_NOT_FOUND",
          error: "锚点不存在或无权访问。",
        },
        { status: 404 },
      );
    }
    if (anchor.status === "READY") {
      return NextResponse.json({ ok: true, anchor: productAnchorView(anchor) });
    }

    try {
      const updated = await dependencies.runCutout(anchor.id);
      return NextResponse.json({ ok: true, anchor: productAnchorView(updated) });
    } catch (error) {
      console.error("[product-anchors:retry]", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        {
          ok: false,
          code: "ANCHOR_RETRY_FAILED",
          error: "抠图续跑失败，请稍后重试。",
        },
        { status: 503 },
      );
    }
  };
}

const productAnchorRetry = createProductAnchorRetryHandler();
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return productAnchorRetry(req, context);
}
