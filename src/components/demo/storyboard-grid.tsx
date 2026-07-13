import {
  Award,
  BookOpen,
  Clock,
  Heart,
  PanelTopOpen,
  Smartphone,
  Users,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  storyboardShots,
  type StoryboardShotDemo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";

const ICON_MAP: Record<StoryboardShotDemo["visualPlaceholder"]["iconKey"], React.ReactNode> = {
  opener: <BookOpen size={32} />,
  figure: <Users size={32} />,
  tap: <Smartphone size={32} />,
  window: <PanelTopOpen size={32} />,
  family: <Heart size={32} />,
  endcard: <Award size={32} />,
};

export function StoryboardGrid() {
  return (
    <DemoSection
      id="storyboard"
      eyebrow="第 5 步 · 分镜与拍摄指导"
      title="6 张可以直接交给摄影或 AI 管线的分镜卡。"
      description="每张分镜卡都是一条可执行指令：拍什么、怎么拍、是否必拍、常见踩坑。同样的结构既能传给真人摄影团队，也能直接喂给 image-to-video 引擎。"
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {storyboardShots.map((shot) => (
          <ShotCard key={shot.sceneIndex} shot={shot} />
        ))}
      </div>

      <p className="mt-6 rounded-(--radius-lg) border border-border bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
        合计 {storyboardShots.length} 个镜头 · 总时长{" "}
        {storyboardShots.reduce((sum, s) => sum + s.durationSec, 0)} 秒 · 必拍{" "}
        {storyboardShots.filter((s) => s.requiredFlag).length} · 可选{" "}
        {storyboardShots.filter((s) => !s.requiredFlag).length}。输出结构对齐{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">
          ShootingGuideDoc
        </code>{" "}
        （Phase 2）。
      </p>

      <p className="mt-3 rounded-(--radius-lg) border border-primary/25 bg-primary/[0.07] px-4 py-3 text-xs leading-5 text-primary/90">
        选定方向、AI 脚本、分镜与质检通过的素材，会汇成 Sunny Shutter 30 秒主版本——下方
        <a
          href="#final-output"
          className="ml-1 font-semibold underline decoration-dotted underline-offset-4 hover:text-primary"
        >
          直接播放成片
        </a>
        ，或往下滑看
        <a
          href="#local-product-sample"
          className="ml-1 font-semibold underline decoration-dotted underline-offset-4 hover:text-primary"
        >
          Mapleside Living 的本地零售样片
        </a>
        。
      </p>
    </DemoSection>
  );
}

function ShotCard({ shot }: { shot: StoryboardShotDemo }) {
  /*
   * 优先用真实视频帧（来自 Sunny Shutter 30s 成片的 6 个关键时刻）作为分镜
   * 缩略图，让分镜卡看着像真实交付物而不是渐变 placeholder；
   * 如果 thumbnailUrl 缺失（例如未来扩展到其他案例还没生成帧）则 fallback
   * 回原来的渐变 + icon 风格。
   */
  const thumbnailUrl = shot.visualPlaceholder.thumbnailUrl;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-(--radius-lg) border border-border bg-card">
      <div className="relative aspect-9/12 w-full overflow-hidden bg-muted">
        {thumbnailUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailUrl}
              alt={shot.visualPlaceholder.accentLabel}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              draggable={false}
            />
            <div className="absolute inset-x-0 top-0 h-24 bg-overlay" />
            <div className="absolute inset-x-0 bottom-0 h-32 bg-overlay" />
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-card">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-overlay ">
              {ICON_MAP[shot.visualPlaceholder.iconKey]}
            </div>
            <p className="mt-3 text-sm font-semibold tracking-wide">
              {shot.visualPlaceholder.accentLabel}
            </p>
          </div>
        )}

        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-overlay px-2 py-1 text-meta font-mono text-card ">
            <Clock size={10} /> {shot.durationSec}s
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium ",
              shot.requiredFlag
                ? "bg-danger text-card"
                : "bg-muted text-foreground",
            )}
          >
            {shot.requiredFlag ? "必拍" : "可选"}
          </span>
        </div>

        {/* 真实视频帧 → 把镜头标题叠加在右下角，icon 缩小成小徽标；
            placeholder 模式（无 thumbnail）由上方居中渲染负责，这里不重复显示 */}
        {thumbnailUrl ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-success px-2 py-1 text-meta font-semibold text-card ">
            真实成片帧
          </span>
        ) : null}

        {shot.captionText ? (
          <div className="absolute inset-x-3 bottom-3 rounded-(--radius-md) bg-foreground px-3 py-2 text-center text-xs leading-5 text-background ">
            {shot.captionText}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-meta font-mono uppercase tracking-[0.2em] text-primary">
            镜头 {String(shot.sceneIndex).padStart(2, "0")} ·{" "}
            {shot.shotTypeLabel}
          </p>
          <h3 className="mt-1 text-sm font-semibold leading-snug">
            {shot.whatToFilm}
          </h3>
        </div>

        <div className="rounded-(--radius-lg) bg-muted p-3 text-xs leading-5">
          <p className="font-medium text-foreground">运镜指令</p>
          <p className="mt-1 text-muted-foreground">{shot.cameraInstruction}</p>
        </div>

        {shot.voiceoverSegment ? (
          <div className="rounded-(--radius-lg) bg-muted p-3 text-xs leading-5">
            <p className="font-medium text-foreground">对应口播</p>
            <p className="mt-1 italic text-muted-foreground">
              “{shot.voiceoverSegment}”
            </p>
          </div>
        ) : null}

        <div>
          <p className="text-meta font-medium uppercase tracking-[0.18em] text-muted-foreground">
            拍摄要点
          </p>
          <ul className="mt-1.5 space-y-1 text-xs leading-5 text-muted-foreground">
            {shot.shootingRequirements.map((req) => (
              <li key={req} className="flex items-start gap-2">
                <CheckCircle2
                  size={11}
                  className="mt-1 shrink-0 text-success"
                />
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5 text-meta">
          <Tag>{compositionZh(shot.composition)}</Tag>
          <Tag>{movementZh(shot.cameraMovement)}</Tag>
          <Tag>{orientationZh(shot.orientation)}</Tag>
          {shot.humanRequired ? <Tag tone="primary">需要真人出镜</Tag> : null}
        </div>
      </div>
    </article>
  );
}

const COMPOSITION_ZH: Record<string, string> = {
  rule_of_thirds: "三分构图",
  centered: "居中构图",
  symmetrical: "对称构图",
  leading_lines: "引导线",
  frame_within_frame: "画中画",
  negative_space: "留白",
};

const MOVEMENT_ZH: Record<string, string> = {
  static: "静止",
  pan: "横摇",
  tilt: "俯仰",
  push_in: "推进",
  pull_out: "拉远",
  tracking: "跟拍",
  handheld: "手持",
  gimbal: "稳定器",
};

function compositionZh(c: string): string {
  return COMPOSITION_ZH[c] ?? c.replace(/_/g, " ");
}

function movementZh(m: string): string {
  return MOVEMENT_ZH[m] ?? m.replace(/_/g, " ");
}

function orientationZh(o: string): string {
  if (o === "portrait") return "竖屏";
  if (o === "landscape") return "横屏";
  if (o === "square") return "方屏";
  return o;
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "primary";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-medium",
        tone === "primary"
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
