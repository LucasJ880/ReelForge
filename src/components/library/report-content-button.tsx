"use client";

import { useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n/useTranslation";

export function ReportContentButton({ briefId }: { briefId: string }) {
  const { locale } = useTranslation();
  const english = locale === "en-US";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setBusy(true); setMessage(null);
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ briefId, reason: formData.get("reason"), details: formData.get("details") }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setMessage(english ? "Submission failed. Try again." : "提交失败，请稍后再试。"); return; }
    setMessage(english ? "Report submitted. The review team will retain the audit record and respond." : "已提交。内部团队会保留审计记录并处理。");
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button type="button" variant="ghost" size="sm"><Flag aria-hidden />{english ? "Report content" : "举报内容"}</Button>} />
    <DialogContent>
      <DialogHeader><DialogTitle>{english ? "Report this video" : "举报这支视频"}</DialogTitle><DialogDescription>{english ? "Choose a reason. The review team can take down urgent risks while preserving the original audit record." : "请选择原因。紧急风险可由内部团队一键下架，原始审计记录不会被删除。"}</DialogDescription></DialogHeader>
      <form action={(data) => void submit(data)} className="space-y-4">
        <label className="block space-y-2 text-body"><span>{english ? "Reason" : "原因"}</span><select name="reason" required defaultValue="QUALITY_FAILURE" className="h-10 w-full rounded-(--radius-sm) border border-border bg-secondary px-3"><option value="QUALITY_FAILURE">{english ? "Severe quality failure" : "严重质量问题"}</option><option value="UNSAFE_CONTENT">{english ? "Unsafe content" : "不安全内容"}</option><option value="IP_OR_BRAND">{english ? "Intellectual property or brand" : "知识产权或品牌"}</option><option value="PRIVACY">{english ? "Privacy concern" : "隐私问题"}</option><option value="MISLEADING">{english ? "Misleading content" : "误导性内容"}</option><option value="OTHER">{english ? "Other" : "其他"}</option></select></label>
        <label className="block space-y-2 text-body"><span>{english ? "Details (optional)" : "说明（可选）"}</span><textarea name="details" maxLength={2000} rows={4} className="w-full rounded-(--radius-sm) border border-border bg-secondary p-3" /></label>
        {message ? <p role="status" className="text-meta text-muted-foreground">{message}</p> : null}
        <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Flag aria-hidden />}{english ? "Submit report" : "提交举报"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
