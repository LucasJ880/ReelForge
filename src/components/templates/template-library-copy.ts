import type { Locale } from "@/i18n/config";

/**
 * 模板库自有文案：行情头读数、卡片套用读数与「样片待补」的分镜时间线。
 * 壳层公共文案在 platform-copy；这里只放模板库这一页新增的读数与标签，中英同形。
 */
export type TemplateLibraryCopy = {
  board: {
    label: string;
    recipes: string;
    recipesCaption: string;
    samples: string;
    samplesCaption: string;
    used: string;
    usedCaption: string;
    filled: string;
    filledCaption: string;
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
      recipes: "模板配方",
      recipesCaption: "{n} 个分类",
      samples: "已验收样片",
      samplesCaption: "{n} 条样片待补",
      used: "近 30 天套用批次",
      usedCaption: "用到 {n} 个模板",
      filled: "近 30 天成交成片",
      filledCaption: "下单 {n} 条",
      scope: "样片只收逐条真机验收通过的；套用与成片按你近 30 天的批次统计",
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
      recipes: "Template recipes",
      recipesCaption: "{n} categories",
      samples: "Verified samples",
      samplesCaption: "{n} samples pending",
      used: "Batches · last 30 days",
      usedCaption: "{n} templates used",
      filled: "Filled videos · last 30 days",
      filledCaption: "{n} ordered",
      scope: "Samples count only renders that passed per-template QA; usage and fills count your batches from the last 30 days",
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
