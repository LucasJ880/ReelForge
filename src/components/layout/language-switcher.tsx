"use client";

import { Globe } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface LanguageSwitcherProps {
  variant?: "sidebar" | "inline";
  className?: string;
}

export function LanguageSwitcher({
  variant = "sidebar",
  className,
}: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useI18n();
  const currentLabel = LOCALE_LABELS[locale];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-10 w-full items-center gap-3 rounded-(--radius-md) text-meta font-medium transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
          variant === "sidebar"
            ? "px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
            : "border border-border bg-card px-3 text-foreground hover:bg-muted",
          className,
        )}
        aria-label={t("language.switch")}
      >
        <Globe className="size-4" strokeWidth={1.5} aria-hidden />
        <span className="flex-1 text-left">{currentLabel}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[160px]">
        {LOCALES.map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => setLocale(code as Locale)}
            className={cn(
              "cursor-pointer",
              code === locale && "bg-sidebar-accent text-foreground",
            )}
          >
            {LOCALE_LABELS[code]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
