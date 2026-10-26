import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import { needsOnboarding } from "@/lib/services/onboarding-service";

/**
 * /app 的去处（C1）：自助注册的客户在上手向导走完或跳过之前先进 /app/welcome；
 * 其他人（以及走完向导的客户）照旧进创作页。内部角色不进向导。
 */
export default async function PlatformHomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app");
  if (!isInternalRole(session.user.role) && (await needsOnboarding(session.user.id))) {
    redirect("/app/welcome");
  }
  redirect("/app/create");
}
