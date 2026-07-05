"use client";

import type { AssetRole, UploadedAsset } from "@/types/video-generation";

/**
 * 共享上传管线（Agent 页 / 创作页共用）：
 * blob 上传 → 读媒体元数据 → 资产分类，产出 UploadedAsset。
 * 与 attachment-uploader 相同协议，但纯函数便于新玻璃 UI 复用。
 */
export async function uploadFilesToAssets(
  files: File[],
  opts?: { forceRole?: AssetRole },
): Promise<UploadedAsset[]> {
  const out: UploadedAsset[] = [];
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    form.append("prefix", "unified-input");
    const uploadRes = await fetch("/api/upload/blob", {
      method: "POST",
      body: form,
    });
    if (!uploadRes.ok) {
      const j = await uploadRes.json().catch(() => ({}));
      throw new Error(j.error ?? `上传失败 (${uploadRes.status})`);
    }
    const { url } = (await uploadRes.json()) as { url: string };

    const { width, height, durationSeconds } = await readMediaMetadata(file);

    let inferredRole: AssetRole = "unknown";
    let roleConfidence = 0.3;
    let suggestedUse: string | null = null;
    let warnings: string[] = [];
    try {
      const classifyRes = await fetch("/api/video-generation/classify-asset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          mimeType: file.type,
          fileName: file.name,
          width,
          height,
          durationSeconds,
          fileSizeBytes: file.size,
        }),
      });
      if (classifyRes.ok) {
        const j = (await classifyRes.json()) as {
          classification: {
            inferredRole: AssetRole;
            roleConfidence: number;
            suggestedUse: string;
            warnings: string[];
          };
        };
        inferredRole = j.classification.inferredRole;
        roleConfidence = j.classification.roleConfidence;
        suggestedUse = j.classification.suggestedUse;
        warnings = j.classification.warnings;
      }
    } catch {
      /* 分类失败不阻塞上传 */
    }

    const type: UploadedAsset["type"] = file.type.startsWith("video/")
      ? "VIDEO"
      : file.type.startsWith("audio/")
        ? "AUDIO"
        : "IMAGE";

    out.push({
      id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      inferredRole,
      roleConfidence,
      url,
      mimeType: file.type,
      fileName: file.name,
      width: width ?? null,
      height: height ?? null,
      durationSeconds: durationSeconds ?? null,
      suggestedUse,
      warnings,
      userAssignedRole: opts?.forceRole ?? null,
    });
  }
  return out;
}

/** 跨页传递创作预填（Agent 页 / 提示词库 → 创作页）。 */
export interface CreatePrefill {
  prompt?: string;
  duration?: 15 | 30 | 60;
  attachments?: UploadedAsset[];
  mode?: "fast" | "director";
  /// 风格模版 ID（style-templates.ts；后端 skill 模式）
  styleTemplateId?: string;
  /// 一致性锁 ID 列表
  consistencyLockIds?: string[];
  /// 口播语言（如 "zh-CN"）
  language?: string;
}

const PREFILL_KEY = "aivora.createPrefill";

export function saveCreatePrefill(prefill: CreatePrefill) {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* storage 不可用时静默忽略 */
  }
}

export function consumeCreatePrefill(): CreatePrefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PREFILL_KEY);
    return JSON.parse(raw) as CreatePrefill;
  } catch {
    return null;
  }
}

async function readMediaMetadata(
  file: File,
): Promise<{ width: number | null; height: number | null; durationSeconds: number | null }> {
  return new Promise((resolve) => {
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight,
          durationSeconds: null,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: null, height: null, durationSeconds: null });
      };
      img.src = url;
      return;
    }
    if (file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: v.videoWidth || null,
          height: v.videoHeight || null,
          durationSeconds: Number.isFinite(v.duration) ? v.duration : null,
        });
      };
      v.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: null, height: null, durationSeconds: null });
      };
      v.src = url;
      return;
    }
    resolve({ width: null, height: null, durationSeconds: null });
  });
}
