import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NewOrderForm } from "./new-order-form";

export default function NewOrderPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="新建广告项目"
        description="上传真实素材，系统将产出市场分析、卖点、脚本、分镜和多轮广告赛马方案"
      />
      <Card>
        <CardContent className="pt-4">
          <NewOrderForm />
        </CardContent>
      </Card>
    </div>
  );
}
