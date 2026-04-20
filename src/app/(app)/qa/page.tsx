import { db } from "@/lib/db";
import { PageHeader } from "@/components/features/page-header";
import { QAList } from "./qa-list";

export const dynamic = "force-dynamic";

export default async function QAPage() {
  const items = await db.qAReview.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: {
      videoBrief: {
        include: {
          contentAngle: {
            include: { round: { include: { deliveryOrder: { select: { id: true, title: true } } } } },
          },
        },
      },
    },
  });

  return (
    <div>
      <PageHeader title="审核队列" description={`共 ${items.length} 条待审核`} />
      <QAList items={items as unknown as QAListItem[]} />
    </div>
  );
}

type QAListItem = React.ComponentProps<typeof QAList>["items"][number];
