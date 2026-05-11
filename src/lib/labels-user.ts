import type {
  AngleType,
  QAStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import type { BriefRenderUserStatus } from "@/lib/services/video-service";

/**
 * User-facing labels（普通客户/运营都能看懂的语言）。
 *
 * 设计原则（来自 2026-05 Lifecycle Hardening 审计）：
 * - 不再让 "渲染 / Brief / Angle / SEEDANCE_T2V / auto_pass" 出现在主 UI；
 *   它们要么被替换成中文友好词，要么被收进可折叠 debug 抽屉。
 * - 所有面向客户的状态首选「正在/已经做了什么」的动词短语，避免技术名词。
 * - 同一份 BRIEF_LABELS 也会被 admin 列表使用 —— 由专门组件控制是否显示 debug。
 */

/// VideoBrief 状态在客户视角下的语义化标签
export const BRIEF_USER_LABELS: Record<VideoBriefStatus, string> = {
  BRIEF_PENDING: "等待开始",
  SCRIPT_DRAFTING: "正在写视频脚本",
  SCRIPT_READY: "视频脚本已准备好",
  SCENE_PROMPT_READY: "分镜已准备好",
  RENDER_QUEUED: "视频请求已发送",
  RENDERING: "正在生成视频",
  RENDER_SUCCEEDED: "视频已生成",
  RENDER_FAILED: "生成失败，可重试",
  QA_PENDING: "正在质量检查",
  QA_APPROVED: "已通过质量检查",
  QA_REJECTED: "需要修改",
  PUBLISH_PENDING: "等待发布",
  PUBLISHED: "已发布",
  METRICS_COLLECTING: "正在收集数据",
  SCORED: "已打分",
  ARCHIVED: "已入选",
  DROPPED: "已淘汰",
};

/// 单个 VideoJob 在客户视角下的状态徽章文案
export const VIDEO_JOB_USER_LABELS: Record<BriefRenderUserStatus, string> = {
  waiting: "等待开始",
  submitted: "视频请求已发送",
  generating: "正在生成视频",
  ready: "视频已生成",
  failed: "生成失败",
  stuck: "生成时间较长",
  cancelled: "已取消",
};

/// 同一个 key 对应的辅助说明（小一号字体 / tooltip 用）
export const VIDEO_JOB_USER_HELPER: Record<BriefRenderUserStatus, string> = {
  waiting: "我们正在排队提交到视频生成服务。",
  submitted: "请求已发送到视频生成服务，等待开始处理。",
  generating: "视频通常 2–5 分钟生成完成，可以离开这个页面稍后回来。",
  ready: "视频已经生成，点击预览查看。",
  failed: "生成失败。可以点击「重试」重新生成，已扣费的请求不会重复扣费。",
  stuck: "生成时间比平时久。可以点「刷新状态」或「重试」。",
  cancelled: "该任务已取消，需要时可重新生成。",
};

/// 进度条 4 步对应的 user-facing 标签
export const VIDEO_PROGRESS_STEPS = [
  { key: "script", label: "视频脚本就绪" },
  { key: "submitted", label: "请求已发送" },
  { key: "generating", label: "正在生成视频" },
  { key: "ready", label: "视频已生成" },
] as const;

/// QA 在客户视角的称呼（去掉「审核」「驳回」「auto_pass」）
export const QA_USER_LABELS: Record<QAStatus, string> = {
  PENDING: "正在质量检查",
  APPROVED: "已通过质量检查",
  REJECTED: "需要修改",
  CHANGES_REQUESTED: "需要修改",
};

/// AI Reviewer 输出的 route 字段（auto_pass / needs_review / reject）→ 客户视角
export const QA_ROUTE_USER_LABELS: Record<string, string> = {
  auto_pass: "自动通过",
  needs_review: "等待人工确认",
  reject: "需要修改",
};

/// Angle 类型（客户应看到「创意方向」而不是 "Angle" / "OPTIMIZATION"）
export const ANGLE_TYPE_USER_LABELS: Record<AngleType, string> = {
  OPTIMIZATION: "优化方向",
  EXPLORATION: "探索方向",
};

/// 主要按钮文案表（避免「触发渲染」「AI 初审」「Render」这种内部词出现在按钮上）
export const ACTION_BUTTON_LABELS = {
  generateVideo: "生成视频",
  regenerateVideo: "重新生成视频",
  refreshStatus: "刷新状态",
  retry: "重试",
  retryAll: "重试所有失败任务",
  generateScript: "生成视频脚本",
  rewriteScript: "重写视频脚本",
  generateScenes: "生成分镜",
  generateAngles: "生成 5 个创意方向",
  generateAds: "生成 5 个创意版本",
  runQA: "进行质量检查",
  generateAdEditPlan: "生成真实素材剪辑计划",
  renderAdEditPlan: "渲染真实素材剪辑计划",
} as const;

/// 跨页面常用术语对照（在普通用户视角替换内部词）
export const COMMON_USER_TERMS = {
  brief: "创意简报",
  angle: "创意方向",
  round: "创意版本组",
  raceRound: "创意版本组",
  script: "视频脚本",
  currentScript: "当前视频脚本",
  scenePlan: "分镜",
  videoPrompt: "视频生成 Prompt",
  research: "市场资料",
  videoJobsSection: "视频生成进度",
  generateFiveAds: "生成 5 个创意版本",
} as const;

/// 把 Brief 状态映射到 4 步进度条上当前应该「点亮」到哪一步
/// 返回 0..4 的数值（0 = 还没到第 1 步；4 = 全部完成）
export function briefStatusToProgressIndex(status: VideoBriefStatus): number {
  switch (status) {
    case "BRIEF_PENDING":
    case "SCRIPT_DRAFTING":
      return 0;
    case "SCRIPT_READY":
    case "SCENE_PROMPT_READY":
      return 1;
    case "RENDER_QUEUED":
      return 2;
    case "RENDERING":
      return 3;
    case "RENDER_SUCCEEDED":
    case "QA_PENDING":
    case "QA_APPROVED":
    case "QA_REJECTED":
    case "PUBLISH_PENDING":
    case "PUBLISHED":
    case "METRICS_COLLECTING":
    case "SCORED":
    case "ARCHIVED":
      return 4;
    case "RENDER_FAILED":
      /// 显示进度但带失败状态由调用方处理
      return 2;
    case "DROPPED":
      return 4;
    default:
      return 0;
  }
}

/// 用于父级聚合徽章：把一组 brief 的进度状态分类
export type AngleProgressBucket =
  | "ready"
  | "generating"
  | "failed"
  | "waiting";

export function bucketBriefForParentSummary(
  status: VideoBriefStatus,
): AngleProgressBucket {
  if (
    status === "RENDER_SUCCEEDED" ||
    status === "QA_PENDING" ||
    status === "QA_APPROVED" ||
    status === "PUBLISH_PENDING" ||
    status === "PUBLISHED" ||
    status === "METRICS_COLLECTING" ||
    status === "SCORED" ||
    status === "ARCHIVED"
  ) {
    return "ready";
  }
  if (status === "RENDERING" || status === "RENDER_QUEUED") {
    return "generating";
  }
  if (status === "RENDER_FAILED" || status === "QA_REJECTED" || status === "DROPPED") {
    return "failed";
  }
  return "waiting";
}

/// 客户友好的 VideoJobStatus 标签（保留旧 admin 标签以便兼容）
export const VIDEO_JOB_STATUS_USER_LABELS: Record<VideoJobStatus, string> = {
  QUEUED: "等待开始",
  RUNNING: "正在生成视频",
  SUCCEEDED: "视频已生成",
  FAILED: "生成失败",
  CANCELLED: "已取消",
};

export function videoJobStatusTone(
  status: BriefRenderUserStatus,
): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "ready":
      return "success";
    case "failed":
      return "danger";
    case "stuck":
      return "warning";
    case "generating":
    case "submitted":
      return "info";
    case "cancelled":
    case "waiting":
    default:
      return "neutral";
  }
}
