from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import DeliveryStatusEnum, TimestampMixin


class Delivery(TimestampMixin, Base):
    __tablename__ = "deliveries"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    project_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("projects.id"), nullable=False
    )
    video_job_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("video_jobs.id"), nullable=False
    )
    qa_report_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("qa_reports.id"), nullable=False
    )
    delivery_format: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    delivery_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    client_feedback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    performance_data_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default=DeliveryStatusEnum.PREPARING.value
    )
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
