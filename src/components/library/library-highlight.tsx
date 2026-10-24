"use client";

import { useEffect } from "react";

/**
 * 成品库 ?highlight=<id>：派发成功后跳回成品库，把刚提交的那一行滚到视野中间。
 * 描边由服务端在那一行写 data-highlighted（globals.css），这里只负责滚动。
 */
export function LibraryHighlight({ rowId }: { rowId: string }) {
  useEffect(() => {
    const target = document.querySelector(`[data-library-row="${CSS.escape(rowId)}"]`);
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [rowId]);
  return null;
}
