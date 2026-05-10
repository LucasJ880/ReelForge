"use client";

import { Badge } from "@/components/ui/badge";
import type { ClientBrief } from "@/lib/schemas/client-brief";

export function WizardBriefSummary({
  brief,
  selectedCardTitle,
  status,
}: {
  brief: ClientBrief | null;
  selectedCardTitle?: string | null;
  status?: string;
}) {
  if (!brief) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
        未检测到合法的 Client Brief —— 请回到 Step 1 重新填写。
      </div>
    );
  }
  return (
    <div className="rounded-md border border-white/10 bg-card/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-base font-semibold tracking-tight">
            {brief.businessName}
          </div>
          <div className="text-xs text-muted-foreground">
            {labelFor(brief.industry)} · {labelFor(brief.objective)} ·{" "}
            {brief.videoLengthSec}s · {labelFor(brief.brandTone)}
          </div>
        </div>
        {status && (
          <Badge variant="outline" className="border-white/20 text-[10px]">
            {status}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {brief.targetPlatforms.map((p) => (
          <Badge
            key={p}
            variant="secondary"
            className="text-[10px] bg-white/5 border-white/10"
          >
            {labelFor(p)}
          </Badge>
        ))}
        {selectedCardTitle && (
          <Badge className="text-[10px] bg-emerald-500/15 border-emerald-400/30 text-emerald-200 border">
            参考卡：{selectedCardTitle}
          </Badge>
        )}
      </div>
      {brief.keyMessage && (
        <p className="text-xs text-muted-foreground italic">
          “{brief.keyMessage}”
        </p>
      )}
    </div>
  );
}

function labelFor(key: string) {
  const map: Record<string, string> = {
    real_estate: "Real Estate",
    pet_business: "Pet Business",
    local_service: "Local Service",
    restaurant: "Restaurant",
    general: "General",
    get_leads: "Get Leads",
    promote_listing: "Promote Listing",
    increase_bookings: "Increase Bookings",
    announce_offer: "Announce Offer",
    brand_awareness: "Brand Awareness",
    professional: "Professional",
    warm: "Warm",
    luxury: "Luxury",
    playful: "Playful",
    educational: "Educational",
    direct_response: "Direct Response",
    tiktok: "TikTok",
    instagram_reels: "IG Reels",
    instagram_feed: "IG Feed",
    youtube_shorts: "YT Shorts",
    youtube: "YouTube",
    facebook: "Facebook",
    website: "Website",
  };
  return map[key] ?? key;
}
