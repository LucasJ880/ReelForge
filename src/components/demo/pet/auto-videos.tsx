import { PhoneVideoMockup } from "@/components/demo/phone-video-mockup";
import { PetSection } from "./pet-section";
import {
  autoVideoDrafts,
  type AutoVideoDraftDemo,
} from "@/lib/demo/pet-content-kit-demo-data";

export function AutoVideos() {
  return (
    <PetSection
      id="auto-videos"
      eyebrow="自动生成视频草稿"
      title="每天自动产出 3-5 条可直接发布的短视频"
      description="系统自动生成宠物语气字幕、标题、文案和话题标签——给主人的可分享内容，也给品牌的种草素材，挑一条就能发。"
    >
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {autoVideoDrafts.map((draft) => (
          <DraftCard key={draft.id} draft={draft} />
        ))}
      </div>
    </PetSection>
  );
}

function DraftCard({ draft }: { draft: AutoVideoDraftDemo }) {
  const audienceStyle =
    draft.audience === "brand"
      ? "border-success bg-success/10 text-success"
      : "border-primary/30 bg-primary/10 text-primary";

  return (
    <div className="border border-border bg-card shadow-editorial flex flex-col gap-4 rounded-(--radius-lg) p-4">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-meta font-semibold ${audienceStyle}`}
        >
          {draft.audienceLabel}
        </span>
        {draft.recommended ? (
          <span className="rounded-full bg-primary px-2.5 py-1 text-meta font-semibold text-primary-foreground">
            推荐发布
          </span>
        ) : null}
      </div>

      <PhoneVideoMockup
        sizeClassName="h-[360px] w-full max-w-[220px]"
        videoUrl={draft.videoUrl}
        posterUrl={draft.posterUrl}
        videoMode="preview"
        statusBadge={draft.durationLabel}
        caption={draft.petVoiceCaption}
        fallbackTitle={draft.title}
        fallbackSubtitle="点击下方查看文案"
      />

      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {draft.postTitle}
        </h3>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {draft.caption}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {draft.hashtags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-secondary px-2 py-0.5 text-meta font-medium text-success"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
