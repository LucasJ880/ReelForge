import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NewOrderForm } from "./new-order-form";

export default function NewOrderPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="新建交付单"
        description="输入产品基础信息，系统将依次产出市场调研 → 卖点 → 多轮赛马视频"
      />
      <Card>
        <CardContent className="pt-4">
          <NewOrderForm />
        </CardContent>
      </Card>
    </div>
  );
}
