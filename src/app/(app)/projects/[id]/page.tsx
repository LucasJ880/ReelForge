import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ProjectDetailClient } from "./client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;

  const project = await db.project.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, name: true, productLine: true, color: true, description: true, features: true } },
      trendRef: { select: { id: true, sourceUrl: true, platform: true, title: true, authorName: true, thumbnailUrl: true, viewCount: true, likeCount: true, styleAnalysis: true } },
      contentPlan: true,
      videoJob: true,
      publication: {
        include: { snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 } },
      },
      analysisReport: true,
    },
  });

  if (!project) notFound();

  return <ProjectDetailClient project={JSON.parse(JSON.stringify(project))} />;
}
