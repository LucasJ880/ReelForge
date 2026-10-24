import type { Locale } from "@/i18n/config";

/**
 * 模板库自有文案：行情头读数、卡片套用读数与「样片待补」的分镜时间线。
 * 壳层公共文案在 platform-copy；这里只放模板库这一页新增的读数与标签，中英同形。
 */
export type TemplateLibraryCopy = {
  board: {
    label: string;
    recipesCaption: string;
    samplesCaption: string;
    usedCaption: string;
    scope: string;
  };
  /// 卡片页脚：本工作区近 30 天用这个模板建了几个批次（只在大于 0 时出现）
  recentBatches: string;
  timeline: {
    pending: string;
    label: string;
    shots: string;
    none: string;
    beats: Record<string, string>;
  };
};

export const TEMPLATE_LIBRARY_COPY: Record<Locale, TemplateLibraryCopy> = {
  "zh-CN": {
    board: {
      label: "模板库读数",
      recipesCaption: "{n} 个分类",
      samplesCaption: "{n} 条样片待补",
      usedCaption: "用到 {n} 个模板",
      scope: "样片只收逐条真机验收通过的；套用按你近 30 天建的批次，成片按近 30 天出片的视频（单条 + 批量）",
    },
    recentBatches: "近 30 天 {n} 批",
    timeline: {
      pending: "样片待补",
      label: "配方分镜时间线",
      shots: "{n} 镜",
      none: "配方未标注分镜",
      beats: {
        HOOK: "钩子",
        PROOF: "卖点证明",
        "SOLUTION PROOF": "方案证明",
        "CTA HOLD": "收尾定格",
      },
    },
  },
  "en-US": {
    board: {
      label: "Template library readings",
      recipesCaption: "{n} categories",
      samplesCaption: "{n} samples pending",
      usedCaption: "{n} templates used",
      scope: "Samples count only renders that passed per-template QA; usage counts batches you built in 30 days, ready counts videos finished in 30 days (single + batch)",
    },
    recentBatches: "{n} batches · 30 days",
    timeline: {
      pending: "Sample pending",
      label: "Recipe shot timeline",
      shots: "{n} shots",
      none: "No timed shots in this recipe",
      beats: {
        HOOK: "Hook",
        PROOF: "Proof",
        "SOLUTION PROOF": "Solution proof",
        "CTA HOLD": "CTA hold",
      },
    },
  },
};

export function fillCount(template: string, n: number): string {
  return template.replace("{n}", String(n));
}
