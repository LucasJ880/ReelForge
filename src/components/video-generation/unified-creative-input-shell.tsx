/**
 * Step 5 placeholder — the real UnifiedCreativeInput component is implemented in Step 6.
 * Keeping this thin server component prevents the persona route pages from breaking before Step 6 lands.
 */
import { UnifiedCreativeInput } from "@/components/video-generation/unified-creative-input";

export function UnifiedCreativeInputShell({
  userType,
}: {
  userType: "business" | "personal";
}) {
  return <UnifiedCreativeInput userType={userType} />;
}
