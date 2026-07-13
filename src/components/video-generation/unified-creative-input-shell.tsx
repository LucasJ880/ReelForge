/**
 * Step 5 placeholder — the real UnifiedCreativeInput component is implemented in Step 6.
 * Keeping this thin server component prevents the persona route pages from breaking before Step 6 lands.
 */
import { UnifiedCreativeInput } from "@/components/video-generation/unified-creative-input";
import type { OrderCreativeDraft } from "@/lib/services/order-creative-draft";
import type { UploadedAsset } from "@/types/video-generation";

export function UnifiedCreativeInputShell({
  userType,
  initialDraft,
  initialAssets,
  initialStyleTemplateId,
}: {
  userType: "business" | "personal" | "platform";
  initialDraft?: OrderCreativeDraft;
  initialAssets?: UploadedAsset[];
  initialStyleTemplateId?: string;
}) {
  return (
    <UnifiedCreativeInput
      userType={userType}
      initialDraft={initialDraft}
      initialAssets={initialAssets}
      initialStyleTemplateId={initialStyleTemplateId}
    />
  );
}
