import { db } from "@/lib/db";

/**
 * 谁是 Aivora 自己的抖音矩阵账号（2026-11-09 · 抖音发布包）。
 *
 * 品牌尾卡的入口 2026-10-28 起对商家关闭（BRAND_END_CARD_ENTRY_ENABLED = false，原因见
 * brand-end-card-policy）。矩阵内容是 Aivora 自己获客，片尾需要一张「Aivora · 主页看更多」，
 * 所以只给内部矩阵账号放开，判定只在服务端做：
 *
 *   DOUYIN_MATRIX_ACCOUNTS=user_id_1,ops@aivora.app   # 逗号分隔，user id 或登录邮箱都行
 *
 * 名单为空 = 没有任何账号是矩阵账号（fail-closed）。客户端只拿到一个布尔值；
 * 本模块引了 db，**不得被 'use client' 文件 import**。
 */

export function douyinMatrixAccounts(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env.DOUYIN_MATRIX_ACCOUNTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.includes("@") ? value.toLowerCase() : value));
}

/** 纯决策：名单里有这个 user id 或邮箱才算。 */
export function decideDouyinMatrixAccount(args: {
  userId: string;
  email?: string | null;
  allowed?: readonly string[];
}): boolean {
  const allowed = args.allowed ?? douyinMatrixAccounts();
  if (allowed.length === 0) return false;
  if (allowed.includes(args.userId)) return true;
  const email = args.email?.trim().toLowerCase();
  return Boolean(email && allowed.includes(email));
}

export async function isDouyinMatrixAccount(userId: string): Promise<boolean> {
  const allowed = douyinMatrixAccounts();
  if (allowed.length === 0) return false;
  if (decideDouyinMatrixAccount({ userId, allowed })) return true;
  /// 名单里只有邮箱时才需要查库
  if (!allowed.some((value) => value.includes("@"))) return false;
  const user = await db.adminUser.findUnique({ where: { id: userId }, select: { email: true } });
  return decideDouyinMatrixAccount({ userId, email: user?.email ?? null, allowed });
}
