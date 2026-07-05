import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

/**
 * Phase 5 routing matrix（Demo 版调整：落地起始界面 = 登录门）:
 *  - 未登录 → /login（玻璃登录门，对齐同行）
 *  - userType=BUSINESS → /business
 *  - userType=PERSONAL → /personal
 *  - userType=OPERATOR / SUPER_ADMIN → /internal/orders
 *  - userType=null（罕见，迁移后存量账号）→ /persona
 */
export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const userType = session.user.userType;
  switch (userType) {
    case "BUSINESS":
      redirect("/business");
    case "PERSONAL":
      redirect("/personal");
    case "OPERATOR":
    case "SUPER_ADMIN":
      redirect("/internal/orders");
    default:
      redirect("/persona");
  }
}
