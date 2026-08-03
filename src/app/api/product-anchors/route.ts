import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  createProductAnchorRequestSchema,
  productAnchorView,
} from "@/lib/contracts/product-anchor-api";
import {
  MediaAssetNotFoundError,
  MediaAssetTypeError,
  resolveOwnedImageAssets,
} from "@/lib/services/media-asset-service";
import {
  createProductAnchor,
  listProductAnchorsForUser,
} from "@/lib/services/product-anchor-service";

/// sharp + 全分辨率 remove.bg，必须跑在 Node 运行时。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/// 抠图同步完成：取原图 + remove.bg（全分辨率可到 ~30s）+ 双上传。
export const maxDuration = 120;

/// 演示账号不跑付费生成（铁律 #4）：抠图按张计费。
const DEMO_EMAIL = "demo@aivora.app";

/// 一个商家的 SKU 是个位数到两位数；上限挡住脚本滥刷付费抠图。
const MAX_ANCHORS_PER_USER = 50;

interface ProductAnchorPostDependencies {
  requireAuth: typeof requireAuth;
  resolveOwnedImageAssets: typeof resolveOwnedImageAssets;
  listProductAnchorsForUser: typeof listProductAnchorsForUser;
  createProductAnchor: typeof createProductAnchor;
}

const defaultPostDependencies: ProductAnchorPostDependencies = {
  requireAuth,
  resolveOwnedImageAssets,
  listProductAnchorsForUser,
  createProductAnchor,
};

/**
 * B1 · 「锚定这个产品」的界面入口（PRD §5 / M5）。
 *
 * 一个 SKU 做一次锚定，之后所有内容复用。同 SKU 重复提交 = 换图重新锚定
 * （服务层 upsert），因此天然幂等，不需要 Idempotency-Key。
 * 抠图失败不报 HTTP 错误：锚点落库为 FAILED + failureReason，
 * 界面展示原因并提供重试/换图出路（铁律 #7：失败不能只给「重试」）。
 */
export function createProductAnchorPostHandler(
  overrides: Partial<ProductAnchorPostDependencies> = {},
) {
  const dependencies = { ...defaultPostDependencies, ...overrides };
  return async function productAnchorPost(req: NextRequest) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;
    const userId = guard.session.user.id;

    if (guard.session.user.email === DEMO_EMAIL) {
      return NextResponse.json(
        {
          ok: false,
          code: "DEMO_BLOCKED",
          error:
            "演示账号不能提交付费抠图。注册一个自己的工作区即可锚定产品。",
        },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = createProductAnchorRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION_FAILED",
          error: "锚定参数不完整或格式不正确（需要 SKU、产品图与产品区域框）。",
        },
        { status: 400 },
      );
    }

    const existing = await dependencies.listProductAnchorsForUser(userId);
    const replacesExisting = existing.some(
      (anchor) => anchor.sku === parsed.data.sku,
    );
    if (!replacesExisting && existing.length >= MAX_ANCHORS_PER_USER) {
      return NextResponse.json(
        {
          ok: false,
          code: "ANCHOR_LIMIT_REACHED",
          error: `产品锚点最多 ${MAX_ANCHORS_PER_USER} 个。如需更多请联系我们；重复提交同一 SKU 会替换旧锚点，不占新额度。`,
        },
        { status: 429 },
      );
    }

    let sourceAsset;
    try {
      [sourceAsset] = await dependencies.resolveOwnedImageAssets({
        userId,
        assetIds: [parsed.data.sourceAssetId],
      });
    } catch (error) {
      if (
        error instanceof MediaAssetNotFoundError ||
        error instanceof MediaAssetTypeError
      ) {
        return NextResponse.json(
          {
            ok: false,
            code: "RESOURCE_NOT_FOUND",
            error: "产品图不存在或无权访问，请重新上传。",
          },
          { status: 404 },
        );
      }
      throw error;
    }

    try {
      const anchor = await dependencies.createProductAnchor({
        userId,
        sku: parsed.data.sku,
        sourceImageUrl: sourceAsset.url,
        brandName: parsed.data.brandName ?? null,
        logoBox: parsed.data.logoBox,
      });
      return NextResponse.json(
        { ok: true, anchor: productAnchorView(anchor) },
        { status: 201 },
      );
    } catch (error) {
      console.error("[product-anchors:POST]", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        {
          ok: false,
          code: "ANCHOR_FAILED",
          error: "锚定提交失败，请稍后重试。",
        },
        { status: 503 },
      );
    }
  };
}

export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const anchors = await listProductAnchorsForUser(guard.session.user.id);
  return NextResponse.json({
    ok: true,
    anchors: anchors.map(productAnchorView),
  });
}

const productAnchorPost = createProductAnchorPostHandler();
export async function POST(req: NextRequest) {
  return productAnchorPost(req);
}
