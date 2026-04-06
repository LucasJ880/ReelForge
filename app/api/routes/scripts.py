from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DBSession
from app.models.script import Script
from app.models.base import ScriptStatusEnum

router = APIRouter()


# ---------- Schemas ----------

class ScriptCreate(BaseModel):
    project_id: str
    brief_id: str
    title: str
    hook: Optional[str] = None
    body: Optional[str] = None
    cta: Optional[str] = None
    voiceover_text: Optional[str] = None
    subtitle_text: Optional[str] = None
    visual_directions_json: Optional[list] = None
    music_style: Optional[str] = None
    duration_seconds: int = 30


class ScriptUpdate(BaseModel):
    title: Optional[str] = None
    hook: Optional[str] = None
    body: Optional[str] = None
    cta: Optional[str] = None
    voiceover_text: Optional[str] = None
    subtitle_text: Optional[str] = None
    visual_directions_json: Optional[list] = None
    music_style: Optional[str] = None
    duration_seconds: Optional[int] = None
    reviewer_notes: Optional[str] = None


class ScriptResponse(BaseModel):
    id: str
    project_id: str
    brief_id: str
    title: str
    hook: Optional[str] = None
    body: Optional[str] = None
    cta: Optional[str] = None
    voiceover_text: Optional[str] = None
    subtitle_text: Optional[str] = None
    visual_directions_json: Optional[list] = None
    music_style: Optional[str] = None
    duration_seconds: int
    version: int
    status: str
    reviewer_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- Routes ----------

@router.post("/", response_model=ScriptResponse, status_code=status.HTTP_201_CREATED)
async def create_script(payload: ScriptCreate, db: DBSession) -> Script:
    script = Script(**payload.model_dump())
    db.add(script)
    await db.flush()
    await db.refresh(script)
    return script


@router.get("/{script_id}", response_model=ScriptResponse)
async def get_script(script_id: str, db: DBSession) -> Script:
    result = await db.execute(select(Script).where(Script.id == script_id))
    script = result.scalar_one_or_none()
    if script is None:
        raise HTTPException(status_code=404, detail="Script not found")
    return script


@router.get("/", response_model=list[ScriptResponse])
async def list_scripts(
    db: DBSession,
    project_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
) -> list[Script]:
    stmt = select(Script)
    if project_id:
        stmt = stmt.where(Script.project_id == project_id)
    stmt = stmt.offset(skip).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.put("/{script_id}", response_model=ScriptResponse)
async def update_script(
    script_id: str, payload: ScriptUpdate, db: DBSession
) -> Script:
    result = await db.execute(select(Script).where(Script.id == script_id))
    script = result.scalar_one_or_none()
    if script is None:
        raise HTTPException(status_code=404, detail="Script not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(script, field, value)

    await db.flush()
    await db.refresh(script)
    return script


@router.post("/{script_id}/approve", response_model=ScriptResponse)
async def approve_script(script_id: str, db: DBSession) -> Script:
    result = await db.execute(select(Script).where(Script.id == script_id))
    script = result.scalar_one_or_none()
    if script is None:
        raise HTTPException(status_code=404, detail="Script not found")

    if script.status != ScriptStatusEnum.REVIEW.value:
        raise HTTPException(
            status_code=400,
            detail=f"Script must be in 'review' status to approve, current: {script.status}",
        )

    script.status = ScriptStatusEnum.APPROVED.value
    await db.flush()
    await db.refresh(script)
    return script
