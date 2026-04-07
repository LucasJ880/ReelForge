import enum
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PlatformEnum(str, enum.Enum):
    TIKTOK = "tiktok"
    YOUTUBE_SHORTS = "youtube_shorts"
    INSTAGRAM_REELS = "instagram_reels"


class ProjectStatusEnum(str, enum.Enum):
    INTAKE = "intake"
    RESEARCH = "research"
    STRATEGY = "strategy"
    SCRIPTING = "scripting"
    PRODUCTION = "production"
    QA = "qa"
    REVIEW = "review"
    DELIVERY = "delivery"
    COMPLETED = "completed"


class BriefStatusEnum(str, enum.Enum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class BudgetTierEnum(str, enum.Enum):
    BASIC = "basic"
    STANDARD = "standard"
    PREMIUM = "premium"


class ScriptStatusEnum(str, enum.Enum):
    DRAFT = "draft"
    REVIEW = "review"
    APPROVED = "approved"
    REJECTED = "rejected"


class VideoJobStatusEnum(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"


class HumanReviewStatusEnum(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class DeliveryStatusEnum(str, enum.Enum):
    PREPARING = "preparing"
    DELIVERED = "delivered"
    ACCEPTED = "accepted"
    REVISION_REQUESTED = "revision_requested"
