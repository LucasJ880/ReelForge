import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import { CreateAdminForm } from "./create-admin-form";
import { AdminRow } from "./admin-row";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    redirect("/orders");
  }
  const users = await db.adminUser.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  return (
    <div>
      <PageHeader
        title="设置 / 账号管理"
        description="仅 SUPER_ADMIN 可管理内部账号"
      />

      <Card className="mb-6">
        <CardContent className="pt-4">
          <CreateAdminForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">邮箱</th>
                <th>姓名</th>
                <th>角色</th>
                <th>创建时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <AdminRow
                  key={u.id}
                  user={{
                    id: u.id,
                    email: u.email,
                    name: u.name,
                    role: u.role,
                    createdAtText: formatDate(u.createdAt),
                  }}
                  isSelf={u.id === session.user.id}
                  roleLabel={ROLE_LABELS[u.role]}
                />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
