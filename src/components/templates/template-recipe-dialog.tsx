"use client";

import { useState } from "react";
import { BookOpenText, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function TemplateRecipeDialog({
  name,
  version,
  promptSkeleton,
  negativePrompt,
  english,
  triggerVariant = "ghost",
}: {
  name: string;
  version: number;
  promptSkeleton: string;
  negativePrompt: string;
  english: boolean;
  triggerVariant?: "ghost" | "outline";
}) {
  const [copied, setCopied] = useState<"prompt" | "negative" | null>(null);

  async function copy(value: string, target: "prompt" | "negative") {
    await navigator.clipboard.writeText(value);
    setCopied(target);
    window.setTimeout(() => setCopied((current) => current === target ? null : current), 1600);
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant={triggerVariant} size="sm">
            <BookOpenText aria-hidden />
            {english ? "View recipe" : "查看质量配方"}
          </Button>
        }
      />
      <DialogContent className="max-h-[min(88vh,52rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {english
              ? `Template v${version} · This is the exact Aivora instruction set used to constrain batch generation.`
              : `模板 v${version} · 以下是 Aivora 在批量生成时实际使用的风格约束。`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <RecipeBlock
            title={english ? "Generation prompt" : "生成指令"}
            value={promptSkeleton}
            copied={copied === "prompt"}
            copyLabel={english ? "Copy prompt" : "复制指令"}
            copiedLabel={english ? "Copied" : "已复制"}
            onCopy={() => void copy(promptSkeleton, "prompt")}
          />
          <RecipeBlock
            title="Negative Prompt"
            value={negativePrompt}
            copied={copied === "negative"}
            copyLabel={english ? "Copy negative prompt" : "复制负向约束"}
            copiedLabel={english ? "Copied" : "已复制"}
            onCopy={() => void copy(negativePrompt, "negative")}
          />
          <p className="rounded-(--radius-md) border border-border bg-muted p-3 text-meta leading-6 text-muted-foreground">
            {english
              ? "{IMAGE_REFS} is replaced with the uploaded product images and {PRODUCT_NAME} with the optional product name. Product truth and continuity constraints always override spectacle."
              : "{IMAGE_REFS} 会替换为本批次上传的产品图，{PRODUCT_NAME} 会替换为产品名称。产品真实性与连续性约束始终高于视觉奇观。"}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecipeBlock({
  title,
  value,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  title: string;
  value: string;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  onCopy: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-(--radius-md) border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="studio-label text-muted-foreground">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onCopy} aria-label={copyLabel}>
          {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-meta leading-6 text-foreground">
        {value}
      </pre>
    </section>
  );
}
