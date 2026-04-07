import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { BatchDetailClient } from "./client";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const batch = await db.batch.findUnique({
    where: { id },
    include: {
      projects: {
        orderBy: { batchIndex: "asc" },
        include: {
          contentPlan: { select: { id: true, caption: true, videoPrompt: true } },
          videoJob: { select: { id: true, status: true, videoUrl: true } },
        },
      },
    },
  });

  if (!batch) notFound();

  return <BatchDetailClient initial={JSON.parse(JSON.stringify(batch))} />;
}
