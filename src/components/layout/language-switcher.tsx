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
          "flex w-full items-center gap-2.5 rounded-md text-sm transition-colors",
          variant === "sidebar"
            ? "px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
            : "px-2.5 py-1.5 border border-white/10 hover:bg-white/5",
          className,
        )}
        aria-label={t("language.switch")}
      >
        <Globe className="h-4 w-4" />
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
