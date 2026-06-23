import { BookHeart, MonitorSmartphone, Sparkles } from "lucide-react";
import { PhoneVideoMockup } from "@/components/demo/phone-video-mockup";
import { PetSection } from "./pet-section";
import { PetImage } from "./pet-image";
import {
  dailyClip,
  desktopPet,
  moodCard,
  petDiary,
} from "@/lib/demo/pet-content-kit-demo-data";

export function CompanionMode() {
  return (
    <PetSection
      id="companion"
      eyebrow="主人陪伴模式"
      title="每天都有一份属于你和宠物的温暖回忆"
      description="可爱短视频、宠物日记、心情卡，再加上桌面小宠物式陪伴体验——给主人持续的情绪价值和打开理由。"
    >
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* 每日可爱视频 */}
        <div className="pet-surface flex flex-col items-center gap-4 rounded-3xl p-5">
          <p className="self-start inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--pet-orange)]">
            <Sparkles size={14} /> 每日可爱视频
          </p>
          <PhoneVideoMockup
            sizeClassName="h-[420px] w-[210px]"
            videoUrl={dailyClip.videoUrl}
            posterUrl={dailyClip.posterUrl}
            videoMode="preview"
            statusBadge={dailyClip.durationLabel}
            fallbackGradient="from-amber-300/40 via-orange-200/30 to-emerald-300/30"
            fallbackTitle={dailyClip.title}
          />
          <p className="text-center text-xs leading-5 text-muted-foreground">
            {dailyClip.caption}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* 宠物日记 */}
          <div className="pet-surface flex flex-col overflow-hidden rounded-3xl sm:col-span-2">
            <div className="flex flex-col sm:flex-row">
              <div className="relative h-44 w-full overflow-hidden sm:h-auto sm:w-48 sm:shrink-0">
                <PetImage
                  src={petDiary.imageUrl}
                  alt="宠物日记配图"
                  fallbackLabel="宠物日记"
                  fallbackEmoji="📔"
                />
              </div>
              <div className="flex-1 p-5">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--pet-orange)]">
                  <BookHeart size={14} /> 宠物日记 · 以宠物口吻自动撰写
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {petDiary.date}
                  </span>
                  <span className="rounded-full bg-[var(--pet-teal)]/10 px-2 py-0.5 text-[11px] font-medium text-[color:var(--pet-teal)]">
                    {petDiary.moodEmoji} {petDiary.mood}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {petDiary.body}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {petDiary.highlights.map((h) => (
                    <span
                      key={h}
                      className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] text-foreground/80"
                    >
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 心情卡 */}
          <div className="pet-surface relative overflow-hidden rounded-3xl p-5">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[var(--pet-orange)]/15 blur-2xl" />
            <p className="text-xs font-semibold text-[color:var(--pet-orange)]">
              心情卡
            </p>
            <p className="mt-3 text-2xl">{moodCard.emoji}</p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {moodCard.mood}
            </p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              {moodCard.line}
            </p>
          </div>

          {/* 桌面小宠物 */}
          <div className="pet-surface flex flex-col justify-between rounded-3xl p-5">
            <div>
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--pet-teal)]">
                <MonitorSmartphone size={14} /> {desktopPet.title}
              </p>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                {desktopPet.description}
              </p>
            </div>
            <span className="mt-4 self-start rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-muted-foreground">
              {desktopPet.comingSoonLabel}
            </span>
          </div>
        </div>
      </div>
    </PetSection>
  );
}
