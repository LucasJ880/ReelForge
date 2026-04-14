import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const products = await db.productCatalog.findMany({
    where: { isActive: true },
    orderBy: [{ productLine: "asc" }, { color: "asc" }],
  });

  return NextResponse.json(products);
}
