/**
 * Phase 3 — Personal (C-side) Status Adapter
 *
 * 把内部状态机映射成面向 C 端个人用户的简化状态。
 * 文案比 B2B 更轻、更口语化（"视频已完成" 而非 "视频已就绪"），
 * 且不暴露任何内部术语（Seedance / ffmpeg / provider / blob / stitch...）。
 *
 * 实现策略：底层复用 deriveBusinessStatus 的状态分类逻辑，外层只替换
 * label / shortLabel / cta 等客户文案。这样 C-side 与 B-side 始终
 * 共享同一份状态机真理（避免后端语义漂移），又能各自维护各自的口吻。
 */

import {
  containsBannedCustomerTerm,
  deriveBusinessStatus,
  type BusinessStatusInput,
  type BusinessVideoStatus,
} from "./business-status";

export type PersonalVideoStatus = BusinessVideoStatus;

export interface PersonalStatusOutput {
  status: PersonalVideoStatus;
  /// C 端可见的中文长文案（友好、口语化，不含内部术语）
  label: string;
  /// C 端可见的短标签（≤6 字，给状态徽章用）
  shortLabel: string;
  /// 0..1，仅作进度条参考（不精确）
  progressHint: number;
  /// C 端下一步动作文案（null 表示无 CTA）
  cta: string | null;
  /// 给 UI 的简短进度提示（无内部术语；ready/failed 时为 null）
  progressHint_text: string | null;
}

/**
 * Phase 3 demo spec 要求的 5 类客户文案。
 * 任何编辑都不能让这些字符串泄漏内部术语（由测试守门）。
 */
const LABELS: Record<PersonalVideoStatus, string> = {
  planning: "准备中",
  generating: "生成中",
  assembling: "马上就好",
  ready: "视频已完成",
  failed: "生成失败，请重试",
};

const SHORT_LABELS: Record<PersonalVideoStatus, string> = {
  planning: "准备中",
  generating: "生成中",
  assembling: "马上好",
  ready: "已完成",
  failed: "失败",
};

const CTAS: Record<PersonalVideoStatus, string | null> = {
  planning: null,
  generating: null,
  assembling: null,
  ready: "查看视频",
  failed: "重新生成",
};

const PROGRESS_HINT_TEXT: Record<PersonalVideoStatus, string | null> = {
  planning: "正在为您准备脚本",
  generating: "AI 正在生成画面",
  assembling: "正在合成最终视频",
  ready: null,
  failed: null,
};

/**
 * 主入口：把 brief / finalVideo / job 状态翻成 C 端友好的展示模型。
 *
 * 状态分类逻辑直接复用 deriveBusinessStatus，确保 B/C 端
 * 对"什么算 ready / failed / generating" 的判定永远一致。
 */
export function derivePersonalStatus(
  input: BusinessStatusInput,
): PersonalStatusOutput {
  const business = deriveBusinessStatus(input);
  const status = business.status;
  return {
    status,
    label: LABELS[status],
    shortLabel: SHORT_LABELS[status],
    progressHint: business.progressHint,
    cta: CTAS[status],
    progressHint_text:
      status === "assembling" && business.assemblingPhase === "waiting"
        ? "画面已生成，正在排队合成"
        : PROGRESS_HINT_TEXT[status],
  };
}

/**
 * 校验最终视频 URL 是否可以安全地展示给 C 端用户。
 * 只允许 http(s) 链接；过滤 null / undefined / file:// / blob: / data: / 相对路径，
 * 防止 dev 环境的本地文件路径或内部协议暴露给客户端。
 */
export function customerSafeFinalVideoUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/**
 * 测试 / CI 守门复用入口：判断字符串是否含 C 端不该看到的内部术语。
 * 与 B2B 端共用 BANNED_CUSTOMER_TERMS，避免两套清单漂移。
 */
export function containsBannedPersonalTerm(input: string): boolean {
  return containsBannedCustomerTerm(input);
}

export const __test__ = {
  LABELS,
  SHORT_LABELS,
  CTAS,
  PROGRESS_HINT_TEXT,
};
