import type {
  AdminRole,
  AngleType,
  DeliveryOrderStatus,
  OnCameraMode,
  PublishStatus,
  QAStatus,
  ResearchStatus,
  RoundStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";

export const DELIVERY_ORDER_LABELS: Record<DeliveryOrderStatus, string> = {
  DRAFT: "草稿",
  RESEARCHING: "市场调研中",
  SELLING_POINTS_READY: "卖点就绪",
  ROUND_ACTIVE: "赛马进行中",
  AWAITING_DISTILLATION: "待蒸馏",
  NEXT_ROUND_SCHEDULED: "下一轮已排",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

export const ROUND_LABELS: Record<RoundStatus, string> = {
  PLANNED: "已规划",
  ANGLES_READY: "Angle 就绪",
  VIDEOS_IN_FLIGHT: "视频生成中",
  AWAITING_PUBLISH: "待发布",
  LIVE: "已上线",
  METRICS_WINDOWS_PENDING: "数据窗口中",
  SCORING: "打分中",
  RANKED: "已排名",
  DISTILLATION_PENDING: "待蒸馏",
  CLOSED: "已关闭",
};

export const BRIEF_LABELS: Record<VideoBriefStatus, string> = {
  BRIEF_PENDING: "待写",
  SCRIPT_DRAFTING: "脚本起草",
  SCRIPT_READY: "脚本就绪",
  SCENE_PROMPT_READY: "分镜就绪",
  RENDER_QUEUED: "渲染排队",
  RENDERING: "渲染中",
  RENDER_SUCCEEDED: "渲染成功",
  RENDER_FAILED: "渲染失败",
  QA_PENDING: "待审核",
  QA_APPROVED: "审核通过",
  QA_REJECTED: "审核驳回",
  PUBLISH_PENDING: "待发布",
  PUBLISHED: "已发布",
  METRICS_COLLECTING: "数据采集中",
  SCORED: "已打分",
  ARCHIVED: "入选 Top3",
  DROPPED: "被淘汰",
};

export const QA_LABELS: Record<QAStatus, string> = {
  PENDING: "待审核",
  APPROVED: "通过",
  REJECTED: "驳回",
  CHANGES_REQUESTED: "要求修改",
};

export const PUBLISH_LABELS: Record<PublishStatus, string> = {
  PENDING: "待下载",
  DOWNLOADED: "已下载",
  UPLOADED: "已上传",
  PUBLISHED: "已发布",
  FAILED: "失败",
  CANCELLED: "已取消",
};

export const RESEARCH_LABELS: Record<ResearchStatus, string> = {
  PENDING: "未开始",
  RUNNING: "进行中",
  READY: "就绪",
  FAILED: "失败",
};

export const VIDEO_JOB_LABELS: Record<VideoJobStatus, string> = {
  QUEUED: "排队",
  PAUSED: "已暂停",
  RUNNING: "运行中",
  SUCCEEDED: "成功",
  FAILED: "失败",
  CANCELLED: "取消",
};

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "超级管理员",
  OPERATOR: "运营",
  REVIEWER: "审核员",
};

export const ANGLE_TYPE_LABELS: Record<AngleType, string> = {
  OPTIMIZATION: "优化型",
  EXPLORATION: "探索型",
};

export const ON_CAMERA_LABELS: Record<OnCameraMode, string> = {
  NONE: "不出镜",
  SELF_RAW: "本人原声",
  SELF_VOICE_REPLACED: "本人·AI换声",
  SELF_SUBTITLED: "本人·字幕优化",
  UGC_AVATAR: "UGC/AI数字人",
  PRODUCT_ONLY: "仅产品",
};

export function briefStatusTone(status: VideoBriefStatus) {
  if (["ARCHIVED", "PUBLISHED", "SCORED", "QA_APPROVED"].includes(status)) {
    return "text-emerald-400";
  }
  if (["RENDER_FAILED", "QA_REJECTED", "DROPPED"].includes(status)) {
    return "text-destructive";
  }
  if (["RENDERING", "RENDER_QUEUED", "SCRIPT_DRAFTING"].includes(status)) {
    return "text-blue-400";
  }
  return "text-muted-foreground";
}
