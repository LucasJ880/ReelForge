/**
 * Sealed compatibility stub. The former China-region OmniHuman implementation
 * is archived at deploy/china-future/code/omnihuman.ts.
 */
import { dryRunRefusalError, isDryRun } from "@/lib/config/dry-run";
import { assertDigitalHumanFeatureEnabled } from "@/lib/features/digital-human";

export interface OmniHumanSubmitOptions {
  imageUrl: string;
  audioUrl: string;
  prompt?: string;
  maskUrl?: string;
  seed?: number;
  reqKey?: string;
}

export interface OmniHumanJobResult {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  rawProviderStatus: string;
  videoUrl?: string;
  errorMessage?: string;
  rawProviderResponse?: unknown;
}

export function isOmniHumanConfigured(): false {
  return false;
}

export async function submitOmniHumanJob(
  _opts: OmniHumanSubmitOptions,
): Promise<{ jobId: string }> {
  void _opts;
  if (isDryRun()) throw dryRunRefusalError("omnihuman");
  assertDigitalHumanFeatureEnabled();
  throw new Error("DIGITAL_HUMAN_SEALED");
}

export async function getOmniHumanStatus(
  _jobId: string,
  _reqKey?: string,
): Promise<OmniHumanJobResult> {
  void _jobId;
  void _reqKey;
  assertDigitalHumanFeatureEnabled();
  throw new Error("DIGITAL_HUMAN_SEALED");
}
