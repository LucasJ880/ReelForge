import {
  AssetQAStatus,
  Prisma,
  RawAssetType,
  type RawAsset,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  parseQAResult,
  parseMissingShotReport,
  type MissingShotReport,
  type QACheck,
  type QAResult,
} from "@/lib/schemas/asset-qa";

/**
 * Asset QA 规则引擎（无 LLM 依赖，确定性输出）。
 *
 * MVP 范围：
 *  - mime / size / duration / resolution / orientation / aspect_ratio
 *  - 必拍镜头是否齐全（与 ScenePlan.requiredFlag 对齐）
 * 后续可扩展：vision_clarity / vision_shake / vision_brightness / asr_audio_quality。
 *
 * 接口设计：
 *  - 所有「AI 重活」走 enrichWithVisionAI(asset) 钩子（Phase 3 实现）；
 *  - QA 结果落 RawAsset.qaResult JSON + qaStatus enum，便于 UI 直接展示。
 */

export interface AssetQAOptions {
  /// 限制单个文件最大字节数（默认 200MB）
  maxFileSizeBytes?: number;
  /// 期望视频时长上限（秒）；默认 90s
  maxDurationSec?: number;
  /// 期望视频时长下限（秒）；默认 1s
  minDurationSec?: number;
  /// 目标朝向：portrait（短视频）/ landscape / square / any
  targetOrientation?: "portrait" | "landscape" | "square" | "any";
  /// 目标比例（"9:16" / "16:9" / "1:1"）
  targetAspectRatio?: string;
}

const DEFAULTS: Required<AssetQAOptions> = {
  maxFileSizeBytes: 200 * 1024 * 1024,
  maxDurationSec: 90,
  minDurationSec: 1,
  targetOrientation: "portrait",
  targetAspectRatio: "9:16",
};

const SUPPORTED_VIDEO_MIME = /^video\/(mp4|quicktime|webm|x-m4v)$/i;
const SUPPORTED_IMAGE_MIME = /^image\/(png|jpe?g|webp)$/i;
const SUPPORTED_AUDIO_MIME = /^audio\/(mpeg|mp4|x-m4a|wav|aac)$/i;

export interface RunAssetQARowInput {
  type: RawAssetType;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  url: string;
  name: string;
}

/**
 * 纯函数：基于 metadata 计算 QA 结果。可独立单元测试。
 */
export function evaluateAssetQA(
  asset: RunAssetQARowInput,
  options: AssetQAOptions = {},
): QAResult {
  const settings = { ...DEFAULTS, ...options };
  const checks: QACheck[] = [];

  /// MIME / 扩展名
  const mimeOk = isMimeSupported(asset.type, asset.mimeType ?? null, asset.url);
  checks.push({
    rule: "mime_supported",
    passed: mimeOk,
    severity: mimeOk ? "info" : "error",
    message: mimeOk
      ? "文件类型受支持"
      : `素材类型不在白名单内：${asset.mimeType ?? extOf(asset.url) ?? "未知"}。请上传 mp4/mov/webm/png/jpg/webp/mp3/wav/m4a/aac`,
    measuredValue: asset.mimeType ?? extOf(asset.url),
  });

  /// 文件大小
  if (typeof asset.fileSizeBytes === "number") {
    const sizeOk = asset.fileSizeBytes <= settings.maxFileSizeBytes;
    checks.push({
      rule: "size_within_limit",
      passed: sizeOk,
      severity: sizeOk ? "info" : "warning",
      message: sizeOk
        ? `文件大小 ${formatBytes(asset.fileSizeBytes)}，在 ${formatBytes(settings.maxFileSizeBytes)} 内`
        : `文件偏大（${formatBytes(asset.fileSizeBytes)} > ${formatBytes(settings.maxFileSizeBytes)}）。建议压缩或裁短`,
      measuredValue: asset.fileSizeBytes,
    });
  }

  /// 视频专属：duration / resolution / orientation / aspect_ratio
  if (asset.type === RawAssetType.VIDEO) {
    if (typeof asset.durationMs === "number") {
      const sec = asset.durationMs / 1000;
      const okHigh = sec <= settings.maxDurationSec;
      const okLow = sec >= settings.minDurationSec;
      const ok = okHigh && okLow;
      checks.push({
        rule: "duration_within_range",
        passed: ok,
        severity: ok ? "info" : "warning",
        message: ok
          ? `视频时长 ${sec.toFixed(1)}s，在 ${settings.minDurationSec}-${settings.maxDurationSec}s 之间`
          : !okLow
            ? `视频太短（${sec.toFixed(1)}s < ${settings.minDurationSec}s），建议补拍`
            : `视频太长（${sec.toFixed(1)}s > ${settings.maxDurationSec}s），建议裁剪`,
        measuredValue: sec,
      });
    }
    const orientation = computeOrientation(asset.width, asset.height);
    const oriOk =
      settings.targetOrientation === "any" ||
      settings.targetOrientation === orientation ||
      orientation === "unknown";
    checks.push({
      rule: "orientation_matches_target",
      passed: oriOk,
      severity: oriOk ? "info" : "warning",
      message: oriOk
        ? `朝向 ${orientation}`
        : `朝向 ${orientation} 与目标 ${settings.targetOrientation} 不一致；建议旋转或重拍`,
      measuredValue: orientation,
    });

    if (asset.width && asset.height) {
      const actualRatio = `${asset.width}:${asset.height}`;
      const reduced = reduceRatio(asset.width, asset.height);
      const ratioOk =
        normalizeRatio(reduced) === normalizeRatio(settings.targetAspectRatio) ||
        settings.targetAspectRatio === "any";
      checks.push({
        rule: "aspect_ratio_matches_target",
        passed: ratioOk,
        severity: ratioOk ? "info" : "warning",
        message: ratioOk
          ? `比例 ${reduced}（${actualRatio}）匹配目标 ${settings.targetAspectRatio}`
          : `比例 ${reduced}（${actualRatio}）与目标 ${settings.targetAspectRatio} 不一致`,
        measuredValue: reduced,
      });

      const minSide = Math.min(asset.width, asset.height);
      const resOk = minSide >= 540;
      checks.push({
        rule: "resolution_acceptable",
        passed: resOk,
        severity: resOk ? "info" : "warning",
        message: resOk
          ? `分辨率 ${asset.width}x${asset.height}`
          : `分辨率偏低（${asset.width}x${asset.height}），建议至少 720x1280`,
        measuredValue: `${asset.width}x${asset.height}`,
      });
    }
  }

  const orientationOut = computeOrientation(asset.width, asset.height);
  const aspectOut =
    asset.width && asset.height
      ? reduceRatio(asset.width, asset.height)
      : "unknown";

  const score = computeScore(checks);
  const status = scoreToStatus(score, checks);

  const reasons: string[] = [];
  const retakeSuggestions: string[] = [];
  for (const check of checks) {
    if (!check.passed && check.severity !== "info") {
      reasons.push(check.message);
      if (check.rule === "duration_within_range") {
        retakeSuggestions.push("调整视频时长到目标范围");
      } else if (check.rule === "orientation_matches_target") {
        retakeSuggestions.push("重新以竖屏 9:16 拍摄并避免后期裁剪");
      } else if (check.rule === "aspect_ratio_matches_target") {
        retakeSuggestions.push(`改用 ${DEFAULTS.targetAspectRatio} 比例重拍`);
      } else if (check.rule === "resolution_acceptable") {
        retakeSuggestions.push("使用更高分辨率重拍（至少 720x1280）");
      } else if (check.rule === "mime_supported") {
        retakeSuggestions.push("转换为 mp4 / mov / webm 后重新上传");
      } else if (check.rule === "size_within_limit") {
        retakeSuggestions.push("用 HandBrake / 系统压缩压到 200MB 以内");
      }
    }
  }

  return parseQAResult({
    status,
    score,
    orientation: orientationOut,
    aspectRatio: aspectOut,
    checks,
    reasons,
    retakeSuggestions,
  });
}

/**
 * 持久化版本：跑一遍 evaluateAssetQA + 写回 RawAsset。
 */
export async function runAssetQAForRawAsset(
  rawAssetId: string,
  options: AssetQAOptions = {},
) {
  const asset = await db.rawAsset.findUnique({ where: { id: rawAssetId } });
  if (!asset) throw new Error("RawAsset 不存在");

  const result = evaluateAssetQA(
    {
      type: asset.type,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
      url: asset.url,
      name: asset.name,
    },
    options,
  );

  return db.rawAsset.update({
    where: { id: rawAssetId },
    data: {
      qaStatus: result.status as AssetQAStatus,
      qaResult: result as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * 缺镜头检测：对一个 brief 的所有 ScenePlan（requiredFlag=true），
 * 检查是否有 RawAsset.matchedShotId 指过来。
 */
export async function detectMissingShotsForBrief(
  briefId: string,
): Promise<MissingShotReport> {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      scripts: { where: { isCurrent: true }, take: 1 },
      contentAngle: {
        include: {
          round: {
            include: {
              deliveryOrder: { include: { rawAssets: true } },
            },
          },
        },
      },
    },
  });
  if (!brief) throw new Error("VideoBrief 不存在");
  const script = brief.scripts[0];
  if (!script) {
    return parseMissingShotReport({ total: 0, matched: 0, missingRequired: 0, shots: [] });
  }
  const scenePlans = await db.scenePlan.findMany({
    where: { scriptId: script.id },
    orderBy: { sceneIndex: "asc" },
  });
  const matchedAssetCountByShot = new Map<string, number>();
  for (const ra of brief.contentAngle.round.deliveryOrder.rawAssets) {
    if (ra.matchedShotId) {
      matchedAssetCountByShot.set(
        ra.matchedShotId,
        (matchedAssetCountByShot.get(ra.matchedShotId) ?? 0) + 1,
      );
    }
  }

  let missingRequired = 0;
  let matched = 0;
  const shots = scenePlans.map((s) => {
    const matchedCount = matchedAssetCountByShot.get(s.id) ?? 0;
    const isMatched = matchedCount > 0;
    if (isMatched) matched += 1;
    if (s.requiredFlag && !isMatched) missingRequired += 1;
    return {
      scenePlanId: s.id,
      sceneIndex: s.sceneIndex,
      visualIntent: s.visualIntent,
      required: s.requiredFlag,
      matched: isMatched,
      reason: isMatched
        ? undefined
        : s.requiredFlag
          ? "必拍镜头尚未匹配到任何素材，请上传或在素材列表中绑定 matchedShotId"
          : "可选镜头未匹配，可保留或补拍",
    };
  });

  return parseMissingShotReport({
    total: scenePlans.length,
    matched,
    missingRequired,
    shots,
  });
}

function isMimeSupported(
  type: RawAssetType,
  mime: string | null,
  url: string,
) {
  const ext = extOf(url);
  if (mime) {
    if (type === RawAssetType.VIDEO) return SUPPORTED_VIDEO_MIME.test(mime);
    if (type === RawAssetType.IMAGE) return SUPPORTED_IMAGE_MIME.test(mime);
    if (type === RawAssetType.AUDIO) return SUPPORTED_AUDIO_MIME.test(mime);
  }
  if (!ext) return false;
  if (type === RawAssetType.VIDEO) return /^(mp4|mov|m4v|webm)$/i.test(ext);
  if (type === RawAssetType.IMAGE) return /^(png|jpe?g|webp)$/i.test(ext);
  if (type === RawAssetType.AUDIO) return /^(mp3|wav|m4a|aac)$/i.test(ext);
  return false;
}

function extOf(url: string) {
  const m = /\.([a-zA-Z0-9]+)(?:\?|#|$)/.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function computeOrientation(
  width?: number | null,
  height?: number | null,
): QAResult["orientation"] {
  if (!width || !height) return "unknown";
  if (Math.abs(width - height) <= Math.min(width, height) * 0.05) return "square";
  return width > height ? "landscape" : "portrait";
}

function reduceRatio(width: number, height: number) {
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function normalizeRatio(ratio: string) {
  const [a, b] = ratio.split(":").map((n) => Number(n));
  if (!a || !b) return ratio;
  const g = gcd(a, b);
  return `${a / g}:${b / g}`;
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)}${units[unit]}`;
}

function computeScore(checks: QACheck[]) {
  if (checks.length === 0) return 0;
  let total = 0;
  for (const c of checks) {
    if (c.passed) total += 100;
    else if (c.severity === "warning") total += 60;
    else if (c.severity === "info") total += 90;
    else total += 0;
  }
  return Math.round(total / checks.length);
}

function scoreToStatus(score: number, checks: QACheck[]): QAResult["status"] {
  const hasFatal = checks.some((c) => !c.passed && c.severity === "error");
  if (hasFatal) return "RETAKE_RECOMMENDED";
  const warningCount = checks.filter(
    (c) => !c.passed && c.severity === "warning",
  ).length;
  /// 业务规则：
  /// - 0 warning → USABLE（阈值 80 用于 score 极端拉低的兜底）
  /// - 1 warning → BARELY_USABLE
  /// - 2+ warning → RETAKE_RECOMMENDED（即使每一项都不致命，叠加起来也不再适合直接进剪辑）
  if (warningCount >= 2) return "RETAKE_RECOMMENDED";
  if (warningCount === 1) return "BARELY_USABLE";
  return score >= 80 ? "USABLE" : "BARELY_USABLE";
}

/// 测试辅助：导出常量
export const ASSET_QA_DEFAULTS = DEFAULTS;

// keep RawAsset import alive for editors / future expansions
export type { RawAsset };
