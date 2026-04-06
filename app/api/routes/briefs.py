from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DBSession
from app.models.brief import Brief

router = APIRouter()


# ---------- Schemas ----------

class BriefCreate(BaseModel):
    project_id: str
    content_goal: str
    target_audience_json: Optional[dict] = None
    brand_tone: Optional[str] = None
    key_messages_json: Optional[list] = None
    reference_links_json: Optional[list] = None
    budget_tier: str = "standard"
    video_count: int = 1
    video_duration_seconds: int = 30
    language: str = "zh"
    deadline: Optional[datetime] = None
    special_requirements: Optional[str] = None


class BriefUpdate(BaseModel):
    content_goal: Optional[str] = None
    target_audience_json: Optional[dict] = None
    brand_tone: Optional[str] = None
    key_messages_json: Optional[list] = None
    reference_links_json: Optional[list] = None
    budget_tier: Optional[str] = None
    video_count: Optional[int] = None
    video_duration_seconds: Optional[int] = None
    language: Optional[str] = None
    deadline: Optional[datetime] = None
    special_requirements: Optional[str] = None
    status: Optional[str] = None


class BriefResponse(BaseModel):
    id: str
    project_id: str
    content_goal: str
    target_audience_json: Optional[dict] = None
    brand_tone: Optional[str] = None
    key_messages_json: Optional[list] = None
    reference_links_json: Optional[list] = None
    budget_tier: str
    video_count: int
    video_duration_seconds: int
    language: str
    deadline: Optional[datetime] = None
    special_requirements: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- Routes ----------

@router.post("/", response_model=BriefResponse, status_code=status.HTTP_201_CREATED)
async def create_brief(payload: BriefCreate, db: DBSession) -> Brief:
    brief = Brief(**payload.model_dump())
    db.add(brief)
    await db.flush()
    await db.refresh(brief)
    return brief


@router.get("/{brief_id}", response_model=BriefResponse)
async def get_brief(brief_id: str, db: DBSession) -> Brief:
    result = await db.execute(select(Brief).where(Brief.id == brief_id))
    brief = result.scalar_one_or_none()
    if brief is None:
        raise HTTPException(status_code=404, detail="Brief not found")
    return brief


@router.get("/", response_model=list[BriefResponse])
async def list_briefs(
    db: DBSession,
    project_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
) -> list[Brief]:
    stmt = select(Brief)
    if project_id:
        stmt = stmt.where(Brief.project_id == project_id)
    stmt = stmt.offset(skip).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.put("/{brief_id}", response_model=BriefResponse)
async def update_brief(
    brief_id: str, payload: BriefUpdate, db: DBSession
) -> Brief:
    result = await db.execute(select(Brief).where(Brief.id == brief_id))
    brief = result.scalar_one_or_none()
    if brief is None:
        raise HTTPException(status_code=404, detail="Brief not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(brief, field, value)

    await db.flush()
    await db.refresh(brief)
    return brief
