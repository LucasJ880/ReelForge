import { redirect } from "next/navigation";

/**
 * /internal/ → /internal/orders（默认登陆页）
 *
 * Step 7 会把 /orders, /rounds, /briefs 等真正搬到 /internal 下面；
 * 在那之前，访问 /internal 时跳回到旧 /orders 主页面。
 */
export default function InternalIndexPage() {
  redirect("/internal/orders");
}
