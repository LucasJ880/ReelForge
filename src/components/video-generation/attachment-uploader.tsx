"use client";

import { useRef, useState } from "react";
import { Image as ImageIcon, Video, X, Loader2 } from "lucide-react";
import type { AssetRole, UploadedAsset } from "@/types/video-generation";

const ASSET_ROLE_LABELS: Record<AssetRole, string> = {
  product_image: "Product image",
  reference_image: "Reference image",
  logo: "Logo",
  intro_clip: "Intro clip",
  outro_clip: "Outro / end card clip",
  ad_clip: "Ad clip",
  store_clip: "Store / b-roll clip",
  product_demo_clip: "Product demo clip",
  logo_animation: "Logo animation",
  existing_commercial: "Existing commercial",
  unknown: "Unknown",
};

const ALL_ROLES: AssetRole[] = [
  "product_image",
  "reference_image",
  "logo",
  "intro_clip",
  "outro_clip",
  "ad_clip",
  "store_clip",
  "product_demo_clip",
  "logo_animation",
  "existing_commercial",
];

interface AttachmentUploaderProps {
  userType: "business" | "personal";
  attachments: UploadedAsset[];
  onChange: (attachments: UploadedAsset[]) => void;
}

export function AttachmentUploader({
  userType,
  attachments,
  onChange,
}: AttachmentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const newOnes: UploadedAsset[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("prefix", "unified-input");
        const uploadRes = await fetch("/api/upload/blob", {
          method: "POST",
          body: form,
        });
        if (!uploadRes.ok) {
          const j = await uploadRes.json().catch(() => ({}));
          throw new Error(j.error ?? `Upload failed (${uploadRes.status})`);
        }
        const { url } = (await uploadRes.json()) as { url: string };

        const { width, height, durationSeconds } = await readMediaMetadata(file);

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

        let inferredRole: AssetRole = "unknown";
        let roleConfidence = 0.3;
        let suggestedUse: string | null = null;
        let warnings: string[] = [];
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

        const type: UploadedAsset["type"] = file.type.startsWith("video/")
          ? "VIDEO"
          : file.type.startsWith("audio/")
            ? "AUDIO"
            : "IMAGE";

        newOnes.push({
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
          userAssignedRole: null,
        });
      }
      onChange([...attachments, ...newOnes]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(idx: number) {
    onChange(attachments.filter((_, i) => i !== idx));
  }

  function setRole(idx: number, role: AssetRole) {
    onChange(
      attachments.map((a, i) =>
        i === idx ? { ...a, userAssignedRole: role } : a,
      ),
    );
  }

  const supportedRoles =
    userType === "personal"
      ? (["product_image", "reference_image", "intro_clip", "outro_clip", "ad_clip"] as AssetRole[])
      : ALL_ROLES;

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-card/60 px-3 py-2 text-sm hover:bg-card/90 transition-colors disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {uploading ? "Uploading…" : "Attach images or clips"}
        </button>
        <span className="text-xs text-muted-foreground">
          Up to 100MB per file · PNG / JPG / WebP / MP4 / MOV / WebM
        </span>
      </div>
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {attachments.length > 0 && (
        <ul className="space-y-2">
          {attachments.map((a, idx) => {
            const role = a.userAssignedRole ?? a.inferredRole;
            const Icon = a.type === "VIDEO" ? Video : ImageIcon;
            return (
              <li
                key={a.id}
                className="flex items-start gap-3 rounded-lg border border-white/10 bg-card/60 p-3"
              >
                <Icon className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {a.fileName}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                      {Math.round(a.roleConfidence * 100)}% confidence
                    </span>
                  </div>
                  {a.suggestedUse && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.suggestedUse}
                    </p>
                  )}
                  <div className="mt-2">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Role
                    </label>
                    <select
                      value={role}
                      onChange={(e) => setRole(idx, e.target.value as AssetRole)}
                      className="mt-1 block w-full max-w-xs rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
                    >
                      {supportedRoles.map((r) => (
                        <option key={r} value={r}>
                          {ASSET_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(a.warnings ?? []).length > 0 && (
                    <ul className="mt-2 text-[11px] text-amber-300/80 space-y-0.5">
                      {(a.warnings ?? []).map((w) => (
                        <li key={w}>· {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(idx)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Remove attachment"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Read width/height/duration from a File (best-effort, never throws). */
async function readMediaMetadata(
  file: File,
): Promise<{ width: number | null; height: number | null; durationSeconds: number | null }> {
  return new Promise((resolve) => {
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight, durationSeconds: null });
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
