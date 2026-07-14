import { createHash } from "node:crypto";

/** RFC 3849 documentation address; unique per run so persistent rehearsal limits stay isolated. */
export function rehearsalClientIpForRun(runId: string): string {
  const hash = createHash("sha256").update(runId).digest("hex");
  return `2001:db8:${hash.slice(0, 4)}:${hash.slice(4, 8)}:${hash.slice(8, 12)}:${hash.slice(12, 16)}::1`;
}
