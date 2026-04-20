/**
 * 本地化 / On-Camera 辅助。
 *
 * MVP：本模块主要提供"验证"能力 —— 对已生成的 angle/script/scene/prompt 检查
 * 目标语言/on-camera 模式是否一致；真正的本地化表达由上游 LLM 在生成时完成。
 */

import { OnCameraMode } from "@prisma/client";

export interface LocaleCheckInput {
  targetLanguage: string;
  scripts: { language: string }[];
  briefOnCamera: OnCameraMode;
  angleLocaleNotes?: Record<string, unknown> | null;
}

export interface LocaleCheckIssue {
  severity: "warning" | "error";
  message: string;
}

export function checkLocaleConsistency(
  input: LocaleCheckInput,
): LocaleCheckIssue[] {
  const issues: LocaleCheckIssue[] = [];
  for (const s of input.scripts) {
    if (!s.language.toLowerCase().startsWith(input.targetLanguage.toLowerCase())) {
      issues.push({
        severity: "error",
        message: `脚本语言 ${s.language} 与目标语言 ${input.targetLanguage} 不一致`,
      });
    }
  }

  const recFromAngle =
    (input.angleLocaleNotes?.on_camera_recommendation as string | undefined) ?? null;
  if (
    recFromAngle &&
    recFromAngle !== input.briefOnCamera &&
    !(recFromAngle === "NONE" && input.briefOnCamera === OnCameraMode.PRODUCT_ONLY)
  ) {
    issues.push({
      severity: "warning",
      message: `Angle 建议出镜模式 ${recFromAngle} 与 Brief ${input.briefOnCamera} 不一致`,
    });
  }

  return issues;
}

export const SUPPORTED_LOCALES = [
  { code: "en-US", language: "en", country: "US", label: "English (US)" },
  { code: "en-GB", language: "en", country: "GB", label: "English (UK)" },
  { code: "fr-CA", language: "fr", country: "CA_QC", label: "Français (Québec)" },
  { code: "fr-FR", language: "fr", country: "FR", label: "Français (France)" },
  { code: "de-DE", language: "de", country: "DE", label: "Deutsch" },
  { code: "es-ES", language: "es", country: "ES", label: "Español (ES)" },
  { code: "es-MX", language: "es", country: "MX", label: "Español (MX)" },
  { code: "ja-JP", language: "ja", country: "JP", label: "日本語" },
  { code: "ko-KR", language: "ko", country: "KR", label: "한국어" },
];
