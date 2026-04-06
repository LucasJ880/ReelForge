from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DBSession
from app.models.video_job import VideoJob
from app.models.base import VideoJobStatusEnum

router = APIRouter()


# ---------- Schemas ----------

class VideoJobCreate(BaseModel):
    project_id: str
    script_id: str
    provider: str
    input_params_json: Optional[dict] = None
    max_retries: int = 3


class VideoJobResponse(BaseModel):
    id: str
    project_id: str
    script_id: str
    provider: str
    status: str
    input_params_json: Optional[dict] = None
    output_url: Optional[str] = None
    output_metadata_json: Optional[dict] = None
    retry_count: int
    max_retries: int
    error_message: Optional[str] = None
    cost_cents: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- Routes ----------

@router.post(
    "/jobs", response_model=VideoJobResponse, status_code=status.HTTP_201_CREATED
)
async def create_video_job(payload: VideoJobCreate, db: DBSession) -> VideoJob:
    job = VideoJob(**payload.model_dump())
    db.add(job)
    await db.flush()
    await db.refresh(job)
    # TODO: dispatch actual video generation task (e.g. via Celery)
    return job


@router.get("/jobs/{job_id}", response_model=VideoJobResponse)
async def get_video_job(job_id: str, db: DBSession) -> VideoJob:
    result = await db.execute(select(VideoJob).where(VideoJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Video job not found")
    return job


@router.get("/jobs/", response_model=list[VideoJobResponse])
async def list_video_jobs(
    db: DBSession,
    project_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
) -> list[VideoJob]:
    stmt = select(VideoJob)
    if project_id:
        stmt = stmt.where(VideoJob.project_id == project_id)
    stmt = stmt.offset(skip).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("/jobs/{job_id}/retry", response_model=VideoJobResponse)
async def retry_video_job(job_id: str, db: DBSession) -> VideoJob:
    result = await db.execute(select(VideoJob).where(VideoJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Video job not found")

    if job.status != VideoJobStatusEnum.FAILED.value:
        raise HTTPException(
            status_code=400,
            detail=f"Only failed jobs can be retried, current: {job.status}",
        )

    if job.retry_count >= job.max_retries:
        raise HTTPException(
            status_code=400,
            detail=f"Max retries ({job.max_retries}) exceeded",
        )

    job.status = VideoJobStatusEnum.RETRYING.value
    job.retry_count += 1
    job.error_message = None
    await db.flush()
    await db.refresh(job)
    # TODO: re-dispatch video generation task
    return job
