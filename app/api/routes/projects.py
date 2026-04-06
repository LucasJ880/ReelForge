from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DBSession
from app.models.project import Project

router = APIRouter()


# ---------- Schemas ----------

class ProjectCreate(BaseModel):
    client_name: str
    client_industry: str
    platform: str = "tiktok"


class ProjectResponse(BaseModel):
    id: str
    client_name: str
    client_industry: str
    platform: str
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectStatusUpdate(BaseModel):
    status: str


# ---------- Routes ----------

@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(payload: ProjectCreate, db: DBSession) -> Project:
    project = Project(**payload.model_dump())
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, db: DBSession) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(
    db: DBSession,
    skip: int = 0,
    limit: int = 20,
) -> list[Project]:
    stmt = select(Project).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.put("/{project_id}/status", response_model=ProjectResponse)
async def update_project_status(
    project_id: str, payload: ProjectStatusUpdate, db: DBSession
) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    project.status = payload.status
    await db.flush()
    await db.refresh(project)
    return project
