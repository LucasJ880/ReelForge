from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import BriefStatusEnum, BudgetTierEnum, TimestampMixin


class Brief(TimestampMixin, Base):
    __tablename__ = "briefs"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    project_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("projects.id"), nullable=False
    )
    target_audience_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    content_goal: Mapped[str] = mapped_column(Text, nullable=False)
    brand_tone: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    key_messages_json: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    reference_links_json: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    budget_tier: Mapped[str] = mapped_column(
        String(50), nullable=False, default=BudgetTierEnum.STANDARD.value
    )
    video_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    video_duration_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=30
    )
    language: Mapped[str] = mapped_column(String(50), nullable=False, default="zh")
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    special_requirements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default=BriefStatusEnum.DRAFT.value
    )
