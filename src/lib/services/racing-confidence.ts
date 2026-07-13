export type RacingConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export interface RacingVariantWindows {
  videoBriefId: string;
  windows: number[];
}

export interface RacingConfidence {
  level: RacingConfidenceLevel;
  score: number;
  variantCount: number;
  expectedSnapshots: number;
  observedSnapshots: number;
  snapshotCoverage: number;
  matureVariantRate: number;
  limitations: string[];
}

/**
 * A deterministic confidence estimate for a racing round.
 *
 * It deliberately measures evidence completeness instead of claiming
 * statistical significance. Five variants with 12/24/48h windows are the
 * Phase 3 target; smaller samples remain usable, but are labelled honestly.
 */
export function calculateRacingConfidence(
  variants: RacingVariantWindows[],
): RacingConfidence {
  const variantCount = variants.length;
  const expectedSnapshots = variantCount * 3;
  const observedSnapshots = variants.reduce(
    (total, variant) =>
      total + new Set(variant.windows.filter((window) => [12, 24, 48].includes(window))).size,
    0,
  );
  const snapshotCoverage = expectedSnapshots
    ? observedSnapshots / expectedSnapshots
    : 0;
  const matureVariants = variants.filter((variant) => variant.windows.includes(48)).length;
  const matureVariantRate = variantCount ? matureVariants / variantCount : 0;
  const sampleFactor = Math.min(variantCount / 5, 1);
  const completeness = snapshotCoverage * 0.7 + matureVariantRate * 0.3;
  const score = roundTo(
    completeness * (0.5 + sampleFactor * 0.5),
    3,
  );

  let level: RacingConfidenceLevel = "LOW";
  if (score >= 0.8 && variantCount >= 3) level = "HIGH";
  else if (score >= 0.5 && variantCount >= 2) level = "MEDIUM";

  const limitations: string[] = [];
  if (variantCount < 5) {
    limitations.push(`当前仅 ${variantCount} 个变体；方向性结论不等同于统计显著性。`);
  }
  if (snapshotCoverage < 1) {
    limitations.push(`12/24/48h 指标完整度为 ${Math.round(snapshotCoverage * 100)}%。`);
  }
  if (matureVariantRate < 1) {
    limitations.push("仍有变体缺少 48h 成熟窗口，排名可能继续变化。");
  }
  if (variantCount === 0) limitations.push("尚无可比较的投放变体。");

  return {
    level,
    score,
    variantCount,
    expectedSnapshots,
    observedSnapshots,
    snapshotCoverage: roundTo(snapshotCoverage, 3),
    matureVariantRate: roundTo(matureVariantRate, 3),
    limitations,
  };
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
