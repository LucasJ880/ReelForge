from typing import Optional
from uuid import uuid4

from sqlalchemy import Boolean, Float, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import HumanReviewStatusEnum, TimestampMixin


class QAReport(TimestampMixin, Base):
    __tablename__ = "qa_reports"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    video_job_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("video_jobs.id"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("projects.id"), nullable=False
    )
    overall_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    visual_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    audio_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    content_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    technical_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    issues_json: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    suggestions_json: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    auto_pass: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    human_review_status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default=HumanReviewStatusEnum.PENDING.value,
    )
    human_reviewer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    human_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
