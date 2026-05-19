/**
 * Step 5 placeholder — the real UnifiedCreativeInput component is implemented in Step 6.
 * Keeping this thin server component prevents the persona route pages from breaking before Step 6 lands.
 */
import { UnifiedCreativeInput } from "@/components/video-generation/unified-creative-input";
import type { OrderCreativeDraft } from "@/lib/services/order-creative-draft";

export function UnifiedCreativeInputShell({
  userType,
  initialDraft,
}: {
  userType: "business" | "personal";
  initialDraft?: OrderCreativeDraft;
}) {
  return (
    <UnifiedCreativeInput userType={userType} initialDraft={initialDraft} />
  );
}
