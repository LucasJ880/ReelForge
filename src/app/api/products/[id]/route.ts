import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { productProfilePatchSchema } from "@/lib/contracts/product-profile";
import {
  ProductProfileImagesError,
  ProductProfileNotFoundError,
  ProductProfileUnavailableError,
  updateProductProfile,
} from "@/lib/services/product-profile-service";

export const dynamic = "force-dynamic";

/** 改一件商品，或归档它（`archived: true`；记录保留，只是不再出现在列表里）。只能动本人的。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = productProfilePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT", error: "商品信息不完整：需要名字和至少一张商品图。" }, { status: 400 });
  }
  try {
    const product = await updateProductProfile(auth.session.user.id, id, parsed.data);
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    if (error instanceof ProductProfileNotFoundError) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "找不到这件商品。" }, { status: 404 });
    }
    if (error instanceof ProductProfileUnavailableError) {
      return NextResponse.json({ ok: false, code: "UNAVAILABLE", error: "商品档案暂时用不了，稍后再试。" }, { status: 503 });
    }
    if (error instanceof ProductProfileImagesError) {
      return NextResponse.json({ ok: false, code: "INVALID_IMAGES", error: "有商品图用不了，请重新上传后再保存。" }, { status: 400 });
    }
    console.error("[products:patch]", error);
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "没改成功，稍后再试。" }, { status: 500 });
  }
}
