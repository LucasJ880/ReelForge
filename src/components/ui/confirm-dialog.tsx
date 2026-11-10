"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 站内确认框（2026-11-10）：取代 `window.confirm`。
 *
 * 浏览器原生确认框是白底系统样式，标题写着网址，按钮永远是「确定 / 取消」，和纯黑工作台不是一个产品；
 * 手机上还会被「不再显示此类对话框」一键吃掉，之后点了没反应。
 *
 * 用法：受控。标题写要做的事（问句），正文写后果，确认按钮写动作本身（「归档」「停用」），不写「确定」。
 * 取消 / 点遮罩 / Esc 都只是关掉，什么都不做。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  tone = "default",
  busy = false,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** danger：停用、放弃这类收不回来的动作 */
  tone?: "default" | "danger";
  busy?: boolean;
  testId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent showCloseButton={false} data-testid={testId} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="leading-snug">{title}</DialogTitle>
          <DialogDescription className="text-pretty">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>{cancelLabel}</DialogClose>
          <Button
            type="button"
            variant={tone === "danger" ? "destructive" : "default"}
            disabled={busy}
            data-confirm-action
            onClick={onConfirm}
          >
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
