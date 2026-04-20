import { listPendingPublish } from "@/lib/services/publish-service";
import { PageHeader } from "@/components/features/page-header";
import { PublishList } from "./publish-list";

export const dynamic = "force-dynamic";

export default async function PublishPage() {
  const items = await listPendingPublish();
  return (
    <div>
      <PageHeader title="发布队列" description={`${items.length} 条待发布 / 上线确认`} />
      <PublishList items={items as unknown as PublishItem[]} />
    </div>
  );
}

type PublishItem = React.ComponentProps<typeof PublishList>["items"][number];
