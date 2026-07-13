import { Heart, Share2 } from "lucide-react";
import { PetSection } from "./pet-section";
import { PetImage } from "./pet-image";
import {
  detectedMoments,
  type DetectedMomentDemo,
} from "@/lib/demo/pet-content-kit-demo-data";

export function DetectedMoments() {
  return (
    <PetSection
      id="moments"
      eyebrow="AI 识别精彩瞬间"
      title="从监控画面，变成内容生产"
      description="AI 自动从长视频里筛选出最可爱、最有传播性、最适合展示产品的片段，并给出可爱度与传播潜力评分。"
      aside={
        <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          今日识别 · {detectedMoments.length} 个高光瞬间
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {detectedMoments.map((moment) => (
          <MomentCard key={moment.id} moment={moment} />
        ))}
      </div>
    </PetSection>
  );
}

function MomentCard({ moment }: { moment: DetectedMomentDemo }) {
  return (
    <div className="border border-border bg-card shadow-editorial group overflow-hidden rounded-lg">
      <div className="relative aspect-[4/5] w-full overflow-hidden">
        <PetImage
          src={moment.imageUrl}
          alt={moment.title}
          fallbackLabel={moment.title}
        />
        {moment.forBrand ? (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-success px-2 py-0.5 text-meta font-semibold text-card">
            产品证据
          </span>
        ) : null}
      </div>
      <div className="p-3.5">
        <h3 className="text-sm font-semibold text-foreground">{moment.title}</h3>
        <p className="mt-0.5 text-meta text-muted-foreground">
          {moment.behaviorLabel}
        </p>
        <div className="mt-3 flex items-center gap-3 text-meta font-medium">
          <span className="inline-flex items-center gap-1 text-danger">
            <Heart size={12} /> 可爱 {moment.cuteScore}
          </span>
          <span className="inline-flex items-center gap-1 text-success">
            <Share2 size={12} /> 传播 {moment.shareScore}
          </span>
        </div>
      </div>
    </div>
  );
}
