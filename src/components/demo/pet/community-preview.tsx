import { Gift, Heart, Trophy } from "lucide-react";
import { PetSection } from "./pet-section";
import { PetImage } from "./pet-image";
import {
  community,
  type CommunityPostDemo,
} from "@/lib/demo/pet-content-kit-demo-data";

export function CommunityPreview() {
  const profile = community.featuredProfile;
  return (
    <PetSection
      id="community"
      eyebrow="宠物社区生态"
      title="长期沉淀为一个以宠物为核心的内容社区"
      description={community.intro}
    >
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* 宠物主页 */}
        <div className="pet-surface overflow-hidden rounded-3xl">
          <div className="relative h-28 w-full overflow-hidden">
            <PetImage src={profile.coverUrl} alt="主页封面" fallbackLabel="" />
          </div>
          <div className="-mt-8 px-5 pb-5">
            <div className="h-16 w-16 overflow-hidden rounded-2xl border-4 border-card bg-card">
              <PetImage
                src={profile.avatarUrl}
                alt={profile.petName}
                fallbackEmoji="🐱"
              />
            </div>
            <h3 className="mt-3 text-lg font-semibold text-foreground">
              {profile.petName}
            </h3>
            <p className="text-xs text-muted-foreground">
              {profile.species} · {profile.ownerHandle}
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-2">
              {profile.stats.map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl border border-border bg-background/60 p-2.5 text-center"
                >
                  <dd className="text-sm font-semibold text-foreground">
                    {s.value}
                  </dd>
                  <dt className="text-[10px] text-muted-foreground">
                    {s.label}
                  </dt>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Feed + 挑战赛 + 品牌试用 */}
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-3 text-xs font-semibold text-muted-foreground">
              社区内容流
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {community.feed.map((post) => (
                <FeedCard key={post.ownerHandle} post={post} />
              ))}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-[1fr_1fr]">
            {/* 挑战赛 */}
            <div className="pet-surface rounded-3xl p-5">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--pet-orange)]">
                <Trophy size={14} /> 热门挑战赛
              </p>
              <ul className="mt-3 space-y-2.5">
                {community.challenges.map((c) => (
                  <li
                    key={c.title}
                    className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-background/60 px-3 py-2.5"
                  >
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        {c.title}
                      </p>
                      <p className="text-[11px] text-[color:var(--pet-teal)]">
                        {c.tag}
                      </p>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {c.participants}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 品牌试用 */}
            <div className="pet-surface rounded-3xl p-5">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--pet-teal)]">
                <Gift size={14} /> {community.brandTrial.title}
              </p>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                {community.brandTrial.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {community.brandTrial.examples.map((e) => (
                  <span
                    key={e}
                    className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground/80"
                  >
                    {e}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PetSection>
  );
}

function FeedCard({ post }: { post: CommunityPostDemo }) {
  return (
    <div className="pet-surface overflow-hidden rounded-3xl">
      <div className="relative aspect-square w-full overflow-hidden">
        <PetImage src={post.coverUrl} alt={post.caption} fallbackLabel="" />
        {post.badge ? (
          <span className="absolute left-2 top-2 rounded-full bg-[var(--pet-orange)] px-2 py-0.5 text-[10px] font-semibold text-white">
            {post.badge}
          </span>
        ) : null}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 overflow-hidden rounded-full bg-secondary">
            <PetImage src={post.avatarUrl} alt={post.petName} fallbackEmoji="🐾" />
          </div>
          <span className="truncate text-[11px] font-medium text-foreground">
            {post.ownerHandle}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {post.caption}
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-rose-500">
          <Heart size={11} /> {post.likes.toLocaleString("zh-CN")}
        </p>
      </div>
    </div>
  );
}
