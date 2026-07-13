"use client";

import { useRef, useState } from "react";
import { Image as ImageIcon, Video, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  userType: "business" | "personal" | "platform";
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
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {uploading ? "Uploading…" : "Attach images or clips"}
        </Button>
        <span className="text-meta text-muted-foreground">
          Up to 100MB per file · PNG / JPG / WebP / MP4 / MOV / WebM
        </span>
      </div>
      {error && (
        <p role="alert" className="text-meta text-danger">{error}</p>
      )}

      {attachments.length > 0 && (
        <ul className="space-y-2">
          {attachments.map((a, idx) => {
            const role = a.userAssignedRole ?? a.inferredRole;
            const Icon = a.type === "VIDEO" ? Video : ImageIcon;
            return (
              <li
                key={a.id}
                className="flex min-w-0 items-start gap-3 rounded-(--radius-md) border border-border bg-card p-3"
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-body font-medium">
                      {a.fileName}
                    </span>
                    <span className="text-meta text-muted-foreground">
                      {Math.round(a.roleConfidence * 100)}% confidence
                    </span>
                  </div>
                  {a.suggestedUse && (
                    <p className="mt-1 text-meta text-muted-foreground">
                      {a.suggestedUse}
                    </p>
                  )}
                  <div className="mt-2">
                    <label className="text-meta font-medium text-muted-foreground">
                      Role
                      <select
                        value={role}
                        onChange={(e) => setRole(idx, e.target.value as AssetRole)}
                        className="mt-1 block h-10 w-full max-w-xs rounded-(--radius-md) border border-input bg-card px-3 text-body text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {supportedRoles.map((r) => (
                          <option key={r} value={r}>
                            {ASSET_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {(a.warnings ?? []).length > 0 && (
                    <ul className="mt-2 space-y-1 text-meta text-warning">
                      {(a.warnings ?? []).map((w) => (
                        <li key={w}>· {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeAt(idx)}
                  aria-label="Remove attachment"
                >
                  <X strokeWidth={1.5} aria-hidden />
                </Button>
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
