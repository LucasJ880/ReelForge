import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { productProfileCreateSchema } from "@/lib/contracts/product-profile";
import {
  ProductProfileImagesError,
  ProductProfileImportError,
  ProductProfileLimitError,
  ProductProfileUnavailableError,
  createProductProfile,
  listProductProfiles,
} from "@/lib/services/product-profile-service";

export const dynamic = "force-dynamic";

/** 本人的商品档案。 */
export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, products: await listProductProfiles(auth.session.user.id) });
  } catch (error) {
    return failure(error);
  }
}

/** 新建一件商品：手填（名字 + 卖点 + 尺寸 + 商品图），或者把拍过的一单存成档案（fromOrderId）。 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const parsed = productProfileCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT", error: "商品信息不完整：需要名字和至少一张商品图。" }, { status: 400 });
  }
  try {
    const product = await createProductProfile(auth.session.user.id, parsed.data);
    return NextResponse.json({ ok: true, product }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  if (error instanceof ProductProfileUnavailableError) {
    return NextResponse.json({ ok: false, code: "UNAVAILABLE", error: "商品档案暂时用不了，稍后再试。" }, { status: 503 });
  }
  if (error instanceof ProductProfileImagesError) {
    return NextResponse.json({ ok: false, code: "INVALID_IMAGES", error: "有商品图用不了，请重新上传后再保存。" }, { status: 400 });
  }
  if (error instanceof ProductProfileLimitError) {
    return NextResponse.json({ ok: false, code: "LIMIT_REACHED", error: "商品已经存满了，先归档几件不常拍的。" }, { status: 409 });
  }
  if (error instanceof ProductProfileImportError) {
    return NextResponse.json({ ok: false, code: "NOT_IMPORTABLE", error: "这一条没有可用的商品图，存不成商品。" }, { status: 409 });
  }
  console.error("[products]", error);
  return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "没存上，稍后再试。" }, { status: 500 });
}
