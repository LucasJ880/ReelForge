from uuid import uuid4

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import (
    PlatformEnum,
    ProjectStatusEnum,
    TimestampMixin,
)


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_industry: Mapped[str] = mapped_column(String(255), nullable=False)
    platform: Mapped[str] = mapped_column(
        String(50), nullable=False, default=PlatformEnum.TIKTOK.value
    )
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default=ProjectStatusEnum.INTAKE.value
    )
