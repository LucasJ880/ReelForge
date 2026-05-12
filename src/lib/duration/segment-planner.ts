/**
 * 视频时长 → Seedance 分段计划。
 *
 * 用户可选 15s / 30s / 60s 三档；Seedance 单段最长 15s，因此：
 *   15s → 1 段 × 15s
 *   30s → 2 段 × 15s
 *   60s → 4 段 × 15s
 *
 * 这是整个 30s/60s 多段流水线的唯一来源 — director-service / video-service /
 * stitch-service 都从这里读，不允许在别处再重复 15/30/60 的硬编码。
 */

export const SUPPORTED_DURATIONS_SEC = [15, 30, 60] as const;
export type SupportedDurationSec = (typeof SUPPORTED_DURATIONS_SEC)[number];

/// 单段最长（Seedance 限制）
export const SEEDANCE_SEGMENT_MAX_SEC = 15;
export const DEFAULT_TARGET_DURATION_SEC: SupportedDurationSec = 30;

/**
 * 单个段计划。
 * - segmentIndex 从 0 开始，写入 VideoJob.segmentIndex
 * - durationSec：实际请求的时长，一般 = SEEDANCE_SEGMENT_MAX_SEC（15）
 *   但在历史兼容场景（如 20s）下最后一段可能更短
 * - role：用于 Director system prompt 的语义提示
 *   （前段抓注意力 / 中段演示 / 后段呼吁）
 */
export interface SegmentSlot {
  segmentIndex: number;
  durationSec: number;
  role: SegmentRole;
}

export type SegmentRole =
  | "hook"
  | "intro"
  | "demo"
  | "lifestyle"
  | "benefit"
  | "cta";

/**
 * 给定目标时长，返回标准段计划。
 * 超出 SUPPORTED 范围（如旧数据 durationSec=20）会被规范化为「单段近似」。
 */
export function planSegments(
  targetDurationSec: number,
): SegmentSlot[] {
  if (targetDurationSec <= 0) return [];
  if (targetDurationSec <= SEEDANCE_SEGMENT_MAX_SEC) {
    /// ≤15s 视为单段；durationSec 取实际值（兼容旧 20s 数据：会向下截断到 15）
    return [
      {
        segmentIndex: 0,
        durationSec: Math.min(targetDurationSec, SEEDANCE_SEGMENT_MAX_SEC),
        role: "hook",
      },
    ];
  }

  if (targetDurationSec === 30) {
    return [
      { segmentIndex: 0, durationSec: 15, role: "hook" },
      { segmentIndex: 1, durationSec: 15, role: "cta" },
    ];
  }

  if (targetDurationSec === 60) {
    return [
      { segmentIndex: 0, durationSec: 15, role: "hook" },
      { segmentIndex: 1, durationSec: 15, role: "demo" },
      { segmentIndex: 2, durationSec: 15, role: "lifestyle" },
      { segmentIndex: 3, durationSec: 15, role: "cta" },
    ];
  }

  /// 兜底：把任意时长按 15s 切片，最后一段 ≤15s
  const segments: SegmentSlot[] = [];
  let remaining = targetDurationSec;
  let i = 0;
  while (remaining > 0) {
    const dur = Math.min(remaining, SEEDANCE_SEGMENT_MAX_SEC);
    segments.push({
      segmentIndex: i,
      durationSec: dur,
      role: i === 0 ? "hook" : remaining <= SEEDANCE_SEGMENT_MAX_SEC ? "cta" : "demo",
    });
    remaining -= dur;
    i += 1;
  }
  return segments;
}

/**
 * 是否需要走多段拼接流程（并因此创建 FinalVideo 行）。
 * 单段（15s）流程不创建 FinalVideo —— UI 直接读 VideoBrief.finalVideoUrl。
 */
export function requiresStitching(targetDurationSec: number): boolean {
  return planSegments(targetDurationSec).length > 1;
}

/**
 * 把 targetDurationSec 规范化到 SUPPORTED_DURATIONS_SEC 中最接近的值。
 * 用于把旧数据/任意输入归一化展示。
 */
export function normalizeDuration(
  targetDurationSec: number | null | undefined,
): SupportedDurationSec {
  if (!targetDurationSec) return DEFAULT_TARGET_DURATION_SEC;
  let closest: SupportedDurationSec = SUPPORTED_DURATIONS_SEC[0];
  let bestDiff = Math.abs(targetDurationSec - closest);
  for (const candidate of SUPPORTED_DURATIONS_SEC) {
    const diff = Math.abs(targetDurationSec - candidate);
    if (diff < bestDiff) {
      bestDiff = diff;
      closest = candidate;
    }
  }
  return closest;
}

/**
 * 时长选择器选项（UI 用）。i18n key 在调用方拼接，
 * 这里只暴露中性的数据 + label key fragment。
 */
export interface DurationOption {
  durationSec: SupportedDurationSec;
  /// i18n key fragment（拼接到 project.duration.{labelKey}）
  labelKey: "sec15" | "sec30" | "sec60";
  subKey: "sec15Sub" | "sec30Sub" | "sec60Sub";
  recommended: boolean;
}

export const DURATION_OPTIONS: DurationOption[] = [
  { durationSec: 15, labelKey: "sec15", subKey: "sec15Sub", recommended: false },
  { durationSec: 30, labelKey: "sec30", subKey: "sec30Sub", recommended: true },
  { durationSec: 60, labelKey: "sec60", subKey: "sec60Sub", recommended: false },
];
