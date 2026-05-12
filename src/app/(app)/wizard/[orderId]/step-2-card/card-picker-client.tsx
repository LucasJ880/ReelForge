"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";
import type { CreativeEvidenceCard } from "@prisma/client";

type CardLike = CreativeEvidenceCard & {
  _recScore?: number;
  _recReasons?: string[];
};

export function CardPickerClient({
  orderId,
  currentSelectedSlug,
  recommended,
  published,
}: {
  orderId: string;
  currentSelectedSlug: string | null;
  recommended: CardLike[];
  published: CreativeEvidenceCard[];
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    currentSelectedSlug,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!selectedSlug) {
      setError(t("wizard.step2.selectionRequired"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/wizard/projects/${orderId}/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: selectedSlug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.message ??
            t("wizard.step1.errorRequestFailed", { status: res.status }),
        );
        return;
      }
      router.push(`/wizard/${orderId}/step-3-script`);
    });
  };

  return (
    <div className="space-y-8">
      {recommended.length > 0 && (
        <Section
          title={t("wizard.step2.recommendedTitle")}
          subtitle={t("wizard.step2.recommendedSubtitle")}
        >
          <Grid>
            {recommended.map((c) => (
              <CardOption
                key={c.id}
                card={c}
                selected={selectedSlug === c.slug}
                onSelect={() => setSelectedSlug(c.slug)}
                recommendedScore={c._recScore}
                recommendedReasons={c._recReasons}
              />
            ))}
          </Grid>
        </Section>
      )}

      <Section
        title={t("wizard.step2.libraryTitle")}
        subtitle={t("wizard.step2.libraryCount", { count: published.length })}
      >
        <Grid>
          {published.map((c) => (
            <CardOption
              key={c.id}
              card={c}
              selected={selectedSlug === c.slug}
              onSelect={() => setSelectedSlug(c.slug)}
            />
          ))}
          {published.length === 0 && (
            <p className="col-span-full text-xs text-muted-foreground">
              {t("wizard.step2.libraryEmpty")}
            </p>
          )}
        </Grid>
      </Section>

      {error && (
        <p className="text-xs text-rose-300">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <Link href={`/wizard/${orderId}`}>
          <Button variant="outline">{t("wizard.step2.back")}</Button>
        </Link>
        <Button onClick={submit} disabled={pending || !selectedSlug}>
          {pending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" />
          )}
          {t("wizard.step2.confirmAndContinue")}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {subtitle && (
          <span className="text-[10px] text-muted-foreground">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

function CardOption({
  card,
  selected,
  onSelect,
  recommendedScore,
  recommendedReasons,
}: {
  card: CreativeEvidenceCard;
  selected: boolean;
  onSelect: () => void;
  recommendedScore?: number;
  recommendedReasons?: string[];
}) {
  const { t } = useTranslation();
  return (
    <Card
      onClick={onSelect}
      className={cn(
        "cursor-pointer transition-colors border",
        selected
          ? "border-foreground/60 bg-foreground/5"
          : "border-white/10 hover:border-white/30",
      )}
    >
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm leading-snug">{card.title}</CardTitle>
          {recommendedScore !== undefined && (
            <Badge className="bg-emerald-500/15 border-emerald-400/30 text-emerald-200 border text-[10px]">
              <Sparkles className="h-3 w-3 mr-1" />
              {recommendedScore}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[10px] bg-white/5 border border-white/10">
            {t(`industry.${card.industry}`)}
          </Badge>
          <Badge variant="secondary" className="text-[10px] bg-white/5 border border-white/10">
            {t(`platform.${card.platform}`)}
          </Badge>
          <Badge variant="secondary" className="text-[10px] bg-white/5 border border-white/10">
            {t(`objective.${card.objective}`)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {card.clientPreviewSummary && (
          <p className="text-muted-foreground leading-snug">
            {card.clientPreviewSummary}
          </p>
        )}
        {card.whyItWorks && (
          <p className="text-foreground/80 italic leading-snug">
            “{card.whyItWorks}”
          </p>
        )}
        {recommendedReasons && recommendedReasons.length > 0 && (
          <ul className="text-[10px] text-emerald-200 list-disc list-inside">
            {recommendedReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
        {card.referenceUrl && (
          <a
            href={card.referenceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[10px] text-sky-300 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
            {t("wizard.step2.referenceLink")}
          </a>
        )}
      </CardContent>
    </Card>
  );
}
