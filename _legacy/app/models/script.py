from typing import Optional
from uuid import uuid4

from sqlalchemy import ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import ScriptStatusEnum, TimestampMixin


class Script(TimestampMixin, Base):
    __tablename__ = "scripts"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    project_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("projects.id"), nullable=False
    )
    brief_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("briefs.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    hook: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cta: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    voiceover_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    subtitle_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    visual_directions_json: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    music_style: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default=ScriptStatusEnum.DRAFT.value
    )
    reviewer_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
