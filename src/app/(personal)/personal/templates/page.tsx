"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Flame,
  Hand,
  Lightbulb,
  LockKeyhole,
  MapPin,
  MessageCircle,
  PawPrint,
  ScanLine,
  ShoppingBag,
  Target,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { CardAnchor } from "@/components/editorial/card-anchor";
import { saveCreatePrefill } from "@/components/personal/upload-assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CONSISTENCY_LOCKS,
  STYLE_TEMPLATES,
  STYLE_TEMPLATE_CATEGORIES,
  type StyleTemplate,
  type StyleTemplateCategory,
} from "@/lib/video-generation/style-templates";

/**
 * 提示词库（风格模版库）—— 对齐同行「skill 模式」：
 * 模版是后端固化的风格底盘（视觉语言/镜头语言/台词口吻），
 * 前端只做展示与「套用」；一致性锁可叠加勾选后一起带入创作页。
 */

type CategoryFilter = "全部" | (typeof STYLE_TEMPLATE_CATEGORIES)[number];

const TEMPLATE_CATEGORY_ICONS: Record<StyleTemplateCategory, LucideIcon> = {
  爆款广告: Flame,
  电商产品: ShoppingBag,
  UGC达人: UserRound,
  探店种草: MapPin,
  宠物萌宠: PawPrint,
};

const LOCK_ICONS: Record<string, LucideIcon> = {
  lock_product_shape: LockKeyhole,
  lock_hands: Hand,
  lock_lipsync: MessageCircle,
  lock_centered: Target,
  lock_lighting: Lightbulb,
};

export default function TemplatesPage() {
  const router = useRouter();
  const [category, setCategory] = useState<CategoryFilter>("全部");
  const [selectedLocks, setSelectedLocks] = useState<string[]>([
    "lock_product_shape",
    "lock_hands",
  ]);

  const templates = useMemo(
    () =>
      category === "全部"
        ? STYLE_TEMPLATES
        : STYLE_TEMPLATES.filter((t) => t.category === category),
    [category],
  );

  function toggleLock(id: string) {
    setSelectedLocks((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function applyTemplate(tpl: StyleTemplate) {
    saveCreatePrefill({
      prompt: tpl.samplePrompt,
      duration: tpl.defaults.durationSec,
      mode: "fast",
      styleTemplateId: tpl.id,
      consistencyLockIds: selectedLocks,
      language: tpl.defaults.language,
    });
    router.push("/personal/create-video?from=template");
  }

  return (
    <div className="editorial-page-stack min-w-0">
      <header className="max-w-3xl space-y-3">
        <p className="text-meta font-semibold uppercase tracking-widest text-muted-foreground">
          Editorial Template Library
        </p>
        <h1 className="editorial-display">提示词库 · 风格模版</h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          从经过验证的风格底盘开始创作。套用后将模板提示词、镜头语言与一致性约束一并带入创作流程。
        </p>
      </header>

      <section aria-labelledby="template-filter-heading" className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="template-filter-heading"
              className="font-heading text-section font-normal"
            >
              选择风格
            </h2>
            <p className="text-meta text-muted-foreground">
              按创作类型筛选模板，当前显示 {templates.length} 个。
            </p>
          </div>
          <Badge variant="secondary" aria-live="polite">
            {category}
          </Badge>
        </div>

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="模板类别"
        >
          {(["全部", ...STYLE_TEMPLATE_CATEGORIES] as CategoryFilter[]).map(
            (filter) => {
              const active = filter === category;
              return (
                <Button
                  key={filter}
                  type="button"
                  variant={active ? "default" : "outline"}
                  size="sm"
                  aria-pressed={active}
                  onClick={() => setCategory(filter)}
                >
                  {filter}
                </Button>
              );
            },
          )}
        </div>
      </section>

      <section aria-labelledby="template-grid-heading" className="space-y-5">
        <h2 id="template-grid-heading" className="sr-only">
          风格模板
        </h2>
        <ul className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {templates.map((tpl) => {
            const TemplateIcon = TEMPLATE_CATEGORY_ICONS[tpl.category];
            return (
              <li key={tpl.id} className="min-w-0">
                <Card size="sm" className="h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardAnchor icon={TemplateIcon} label={tpl.category} />
                      <div className="flex min-w-0 flex-wrap justify-end gap-x-3 gap-y-2">
                        {tpl.viral ? (
                          <Badge variant="destructive">爆款</Badge>
                        ) : null}
                        {tpl.featured && !tpl.viral ? (
                          <Badge variant="warning">推荐</Badge>
                        ) : null}
                        <Badge variant="secondary">{tpl.category}</Badge>
                      </div>
                    </div>
                    <CardTitle className="mt-3">{tpl.name}</CardTitle>
                    <CardDescription>{tpl.description}</CardDescription>
                  </CardHeader>
                  <CardFooter className="mt-auto flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-meta text-muted-foreground">
                      {tpl.defaults.durationSec}s ·{" "}
                      {tpl.scaffold.dialogueStyle ? "含口播" : "纯质感"}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => applyTemplate(tpl)}
                    >
                      套用模板
                      <ArrowRight strokeWidth={1.5} aria-hidden />
                    </Button>
                  </CardFooter>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="consistency-locks-heading">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle>
                  <h2 id="consistency-locks-heading">一致性锁</h2>
                </CardTitle>
                <CardDescription className="mt-1">
                  可叠加的生成约束，选中后随任意模板一起生效。
                </CardDescription>
              </div>
              <Badge variant="success" aria-live="polite">
                已选 {selectedLocks.length} 项
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <fieldset>
              <legend className="sr-only">选择需要启用的一致性锁</legend>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {CONSISTENCY_LOCKS.map((lock) => {
                  const active = selectedLocks.includes(lock.id);
                  const LockIcon = LOCK_ICONS[lock.id] ?? ScanLine;
                  const descriptionId = `${lock.id}-description`;
                  return (
                    <label key={lock.id} className="block min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleLock(lock.id)}
                        aria-describedby={descriptionId}
                        className="peer sr-only"
                      />
                      <Card
                        size="sm"
                        className="h-full transition-[border-color] duration-fast peer-checked:border-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
                      >
                        <CardContent className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <LockIcon
                              className="size-5 shrink-0 text-primary"
                              strokeWidth={1.5}
                              aria-hidden
                            />
                            <Badge variant={active ? "success" : "secondary"}>
                              {active ? "已启用" : "未启用"}
                            </Badge>
                          </div>
                          <div className="space-y-1">
                            <h3 className="font-heading text-subhead font-normal">
                              {lock.name}
                            </h3>
                            <p
                              id={descriptionId}
                              className="text-meta text-muted-foreground"
                            >
                              {lock.description}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
