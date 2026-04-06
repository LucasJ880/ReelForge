"""
Pydantic 运行时校验模型 — 与 JSON Schema 文件对应
Agent 之间传递数据时通过这些模型做校验
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field
import uuid

SCHEMA_VERSION = "1.0.0"


def _new_id() -> str:
    return uuid.uuid4().hex


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class _TrackedModel(BaseModel):
    """带版本追踪和时间戳的基类"""
    schema_version: str = SCHEMA_VERSION
    created_at: str = Field(default_factory=_now)
    updated_at: str = Field(default_factory=_now)


# ── Enums ──────────────────────────────────────────────

class Platform(str, Enum):
    TIKTOK = "tiktok"
    YOUTUBE_SHORTS = "youtube_shorts"
    INSTAGRAM_REELS = "instagram_reels"
    OTHER = "other"


class ContentGoal(str, Enum):
    BRAND_AWARENESS = "brand_awareness"
    PRODUCT_PROMOTION = "product_promotion"
    LEAD_GENERATION = "lead_generation"
    ENGAGEMENT = "engagement"
    EDUCATION = "education"
    OTHER = "other"


class BudgetTier(str, Enum):
    BASIC = "basic"
    STANDARD = "standard"
    PREMIUM = "premium"


class ScriptStatus(str, Enum):
    DRAFT = "draft"
    REVIEW = "review"
    VALIDATED = "validated"
    NEEDS_REVIEW = "needs_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class VideoJobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


class ReviewStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    AUTO_APPROVED = "auto_approved"


# ── Brief ──────────────────────────────────────────────

class TargetAudience(BaseModel):
    age_range: str = "18-35"
    gender: str = "all"
    interests: list[str] = []
    region: str = ""


class Brief(_TrackedModel):
    brief_id: str = Field(default_factory=_new_id)
    project_id: str = ""
    client_name: str
    client_industry: str = ""
    platform: Platform = Platform.TIKTOK
    target_audience: TargetAudience = Field(default_factory=TargetAudience)
    content_goal: ContentGoal = ContentGoal.BRAND_AWARENESS
    brand_tone: str = "professional"
    key_messages: list[str] = []
    reference_links: list[str] = []
    budget_tier: BudgetTier = BudgetTier.STANDARD
    video_count: int = 1
    video_duration_seconds: int = 30
    language: str = "en"
    deadline: str | None = None
    special_requirements: str = ""
    status: str = "draft"
    raw_requirements: str = ""
    agent_version: str = ""


# ── Research Report ────────────────────────────────────

class ResearchReport(_TrackedModel):
    report_id: str = Field(default_factory=_new_id)
    platform: str = "tiktok"
    industry: str = ""
    data_source: str = "rule_based"
    trending_topics: list[str] = []
    competitor_analysis: dict[str, Any] = {}
    audience_insights: dict[str, Any] = {}
    platform_trends: dict[str, Any] = {}
    recommendations: list[str] = []
    agent_version: str = ""


# ── Strategy ───────────────────────────────────────────

class TopicSuggestion(BaseModel):
    topic: str
    format: str = ""
    angle: str = ""
    duration: int = 30
    priority: str = "medium"


class Strategy(_TrackedModel):
    strategy_id: str = Field(default_factory=_new_id)
    project_id: str = ""
    brief_id: str = ""
    platform: str = "tiktok"
    content_pillars: list[str] = []
    posting_schedule: dict[str, Any] = {}
    tone_guidelines: dict[str, Any] = {}
    topic_suggestions: list[TopicSuggestion] = []
    hashtag_strategy: dict[str, Any] = {}
    agent_version: str = ""
    prompt_version: str = ""
    status: str = "generated"


# ── Script ─────────────────────────────────────────────

class VisualDirection(BaseModel):
    timestamp: str
    description: str
    text_overlay: str = ""
    transition: str = ""


class Script(_TrackedModel):
    script_id: str = Field(default_factory=_new_id)
    project_id: str = ""
    brief_id: str = ""
    topic: str = ""
    title: str
    hook: str
    body: str
    cta: str = ""
    voiceover_text: str = ""
    subtitle_text: str = ""
    visual_directions: list[VisualDirection | dict] = []
    music_style: str = ""
    duration_seconds: int = 30
    version: int = 1
    status: ScriptStatus = ScriptStatus.DRAFT
    reviewer_notes: str = ""
    agent_version: str = ""
    prompt_version: str = ""


# ── Video Job ──────────────────────────────────────────

class VideoJob(_TrackedModel):
    job_id: str = Field(default_factory=_new_id)
    project_id: str = ""
    script_id: str = ""
    provider: str = "mock"
    model: str = ""
    status: VideoJobStatus = VideoJobStatus.PENDING
    input_params: dict[str, Any] = {}
    output_url: str | None = None
    output_metadata: dict[str, Any] = {}
    duration_requested: int = 30
    aspect_ratio: str = "9:16"
    retry_count: int = 0
    max_retries: int = 3
    attempt_count: int = 1
    error_message: str | None = None
    cost_cents: int = 0
    estimated_cost_cents: int = 0
    started_at: str | None = None
    completed_at: str | None = None
    processing_time_ms: int = 0
    agent_version: str = ""


# ── QA Report ──────────────────────────────────────────

class QAIssue(BaseModel):
    type: str
    severity: str
    message: str = ""
    description: str = ""
    suggestion: str = ""


class ScoreDimension(BaseModel):
    score: float = 0
    weight: float = 0
    details: str = ""
    issues: list[dict[str, Any]] = []
    suggestions: list[str] = []


class HumanReview(BaseModel):
    status: ReviewStatus = ReviewStatus.PENDING
    reviewer: str = ""
    notes: str = ""
    reviewed_at: str | None = None


class QAReport(_TrackedModel):
    qa_report_id: str = Field(default_factory=_new_id)
    video_job_id: str = ""
    script_id: str = ""
    job_id: str = ""
    project_id: str = ""
    overall_score: float = 0
    score_breakdown: dict[str, Any] = {}
    issues: list[QAIssue | dict[str, Any]] = []
    suggestions: list[str] = []
    auto_pass: bool = False
    auto_pass_threshold: float = 80
    review_mode: str = "rules"
    human_review: HumanReview = Field(default_factory=HumanReview)
    agent_version: str = ""
    prompt_version: str = ""
    status: str = "generated"


# ── Delivery Record ───────────────────────────────────

class CostSummary(BaseModel):
    llm_cost_cents: int = 0
    video_gen_cost_cents: int = 0
    total_cost_cents: int = 0
    revision_count: int = 0


class DeliveryRecord(_TrackedModel):
    delivery_id: str = Field(default_factory=_new_id)
    project_id: str = ""
    video_job_id: str = ""
    qa_report_id: str = ""
    delivery_format: str = "mp4"
    delivery_url: str = ""
    status: str = "preparing"
    cost_summary: CostSummary = Field(default_factory=CostSummary)
    delivered_at: str | None = None
    agent_version: str = ""
