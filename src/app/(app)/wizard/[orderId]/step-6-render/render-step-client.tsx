"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WizardMockBanner } from "@/components/wizard/wizard-mock-banner";
import { useTranslation } from "@/i18n/useTranslation";
import type { WizardRenderJob } from "@prisma/client";

const MODE_BADGE: Record<string, { className: string; label: string }> = {
  REAL: {
    className: "bg-emerald-500/15 border border-emerald-400/30 text-emerald-200",
    label: "REAL",
  },
  DRAFT: {
    className: "bg-sky-500/15 border border-sky-400/30 text-sky-200",
    label: "DRAFT PREVIEW",
  },
  MOCK: {
    className: "bg-amber-500/15 border border-amber-400/30 text-amber-200",
    label: "MOCK PREVIEW",
  },
};

const STATUS_BADGE: Record<string, string> = {
  QUEUED: "bg-white/5 border border-white/10 text-muted-foreground",
  RUNNING: "bg-sky-500/10 border border-sky-400/30 text-sky-200",
  SUCCEEDED:
    "bg-emerald-500/15 border border-emerald-400/30 text-emerald-200",
  DRAFT_READY:
    "bg-sky-500/15 border border-sky-400/30 text-sky-200",
  MOCK: "bg-amber-500/15 border border-amber-400/30 text-amber-200",
  FAILED: "bg-rose-500/15 border border-rose-400/30 text-rose-200",
};

export function RenderStepClient({
  orderId,
  initialJobs,
  realModeOn,
  ffmpegOk,
}: {
  orderId: string;
  initialJobs: WizardRenderJob[];
  realModeOn: boolean;
  ffmpegOk: boolean;
}) {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState(initialJobs);
  const [aspect, setAspect] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [pending, startRender] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const res = await fetch(`/api/wizard/projects/${orderId}/render`);
    if (!res.ok) return;
    const data = (await res.json()) as { jobs: WizardRenderJob[] };
    setJobs(data.jobs);
  };

  const trigger = () => {
    setError(null);
    startRender(async () => {
      const res = await fetch(`/api/wizard/projects/${orderId}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspectRatio: aspect }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.message ??
            t("wizard.step1.errorRequestFailed", { status: res.status }),
        );
        await refresh();
        return;
      }
      const job = (await res.json()) as WizardRenderJob;
      setJobs((prev) => [job, ...prev].slice(0, 5));
    });
  };

  return (
    <div className="space-y-5">
      <WizardMockBanner
        level="info"
        message={
          realModeOn
            ? t("wizard.step6.bannerLive")
            : t("wizard.step6.bannerDraft", {
                reason: ffmpegOk
                  ? t("wizard.step6.reason.previewModeDisabled")
                  : t("wizard.step6.reason.assemblyUnavailable"),
              })
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">
            {t("wizard.step6.triggerCardTitle")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={aspect}
              onValueChange={(v) =>
                setAspect(v as "9:16" | "1:1" | "16:9")
              }
            >
              <SelectTrigger className="h-8 text-xs w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="9:16">9:16</SelectItem>
                <SelectItem value="1:1">1:1</SelectItem>
                <SelectItem value="16:9">16:9</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={trigger} disabled={pending} size="sm">
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-2" />
              )}
              {t("wizard.step6.triggerButton")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {t("wizard.step6.triggerHelp")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("wizard.step6.recentTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {jobs.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("wizard.step6.recentEmpty")}
            </p>
          )}
          {jobs.map((job) => (
            <RenderJobCard key={job.id} job={job} />
          ))}
        </CardContent>
      </Card>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <div className="flex justify-end gap-2">
        <Link href={`/wizard/${orderId}/step-5-upload`}>
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" /> {t("wizard.step6.back")}
          </Button>
        </Link>
      </div>
    </div>
  );
}

function RenderJobCard({ job }: { job: WizardRenderJob }) {
  const mode = MODE_BADGE[job.mode] ?? MODE_BADGE.DRAFT;
  const statusClass =
    STATUS_BADGE[job.status] ?? "bg-white/5 border border-white/10";
  return (
    <div className="rounded-md border border-white/10 bg-card/40 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge className={`${mode.className} text-[10px]`}>
            {mode.label}
          </Badge>
          <Badge className={`${statusClass} text-[10px]`}>{job.status}</Badge>
          <span className="text-muted-foreground">
            {job.aspectRatio} · {job.durationSec}s
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {new Date(job.createdAt).toLocaleString()}
        </span>
      </div>
      {job.fallbackReason && (
        <p className="text-amber-200/85 italic">{job.fallbackReason}</p>
      )}
      {job.errorMessage && (
        <p className="text-rose-200/85">错误：{job.errorMessage}</p>
      )}
      {job.outputVideoUrl && (
        <PreviewLink label="预览视频" url={job.outputVideoUrl} icon="play" />
      )}
      {job.manifestUrl && (
        <PreviewLink
          label="渲染 manifest"
          url={job.manifestUrl}
          icon="ext"
        />
      )}
    </div>
  );
}

function PreviewLink({
  label,
  url,
  icon,
}: {
  label: string;
  url: string;
  icon: "play" | "ext";
}) {
  const Icon = icon === "play" ? PlayCircle : ExternalLink;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-sky-300 hover:underline"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}
