import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SUPPORTED_LOCALES } from "@/lib/services/localization-service";
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
          {/* 服务端取值、以 props 传给客户端表单（铁律 #5：'use client' 不引服务端 service 的值） */}
          <NewOrderForm locales={SUPPORTED_LOCALES} />
        </CardContent>
      </Card>
    </div>
  );
}
