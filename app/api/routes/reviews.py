from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DBSession
from app.models.qa_report import QAReport
from app.models.base import HumanReviewStatusEnum

router = APIRouter()


# ---------- Schemas ----------

class ReviewCreate(BaseModel):
    video_job_id: str
    project_id: str
    overall_score: float = 0.0
    visual_score: float = 0.0
    audio_score: float = 0.0
    content_score: float = 0.0
    technical_score: float = 0.0
    issues_json: Optional[list] = None
    suggestions_json: Optional[list] = None
    auto_pass: bool = False


class ReviewResponse(BaseModel):
    id: str
    video_job_id: str
    project_id: str
    overall_score: float
    visual_score: float
    audio_score: float
    content_score: float
    technical_score: float
    issues_json: Optional[list] = None
    suggestions_json: Optional[list] = None
    auto_pass: bool
    human_review_status: str
    human_reviewer: Optional[str] = None
    human_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class HumanReviewAction(BaseModel):
    reviewer: str
    notes: Optional[str] = None


# ---------- Routes ----------

@router.post("/", response_model=ReviewResponse, status_code=status.HTTP_201_CREATED)
async def create_review(payload: ReviewCreate, db: DBSession) -> QAReport:
    report = QAReport(**payload.model_dump())
    db.add(report)
    await db.flush()
    await db.refresh(report)
    return report


@router.get("/{review_id}", response_model=ReviewResponse)
async def get_review(review_id: str, db: DBSession) -> QAReport:
    result = await db.execute(select(QAReport).where(QAReport.id == review_id))
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return report


@router.get("/", response_model=list[ReviewResponse])
async def list_reviews(
    db: DBSession,
    video_job_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
) -> list[QAReport]:
    stmt = select(QAReport)
    if video_job_id:
        stmt = stmt.where(QAReport.video_job_id == video_job_id)
    stmt = stmt.offset(skip).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("/{review_id}/approve", response_model=ReviewResponse)
async def approve_review(
    review_id: str, payload: HumanReviewAction, db: DBSession
) -> QAReport:
    result = await db.execute(select(QAReport).where(QAReport.id == review_id))
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="Review not found")

    if report.human_review_status != HumanReviewStatusEnum.PENDING.value:
        raise HTTPException(
            status_code=400,
            detail=f"Review already processed: {report.human_review_status}",
        )

    report.human_review_status = HumanReviewStatusEnum.APPROVED.value
    report.human_reviewer = payload.reviewer
    report.human_notes = payload.notes
    await db.flush()
    await db.refresh(report)
    return report


@router.post("/{review_id}/reject", response_model=ReviewResponse)
async def reject_review(
    review_id: str, payload: HumanReviewAction, db: DBSession
) -> QAReport:
    result = await db.execute(select(QAReport).where(QAReport.id == review_id))
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="Review not found")

    if report.human_review_status != HumanReviewStatusEnum.PENDING.value:
        raise HTTPException(
            status_code=400,
            detail=f"Review already processed: {report.human_review_status}",
        )

    report.human_review_status = HumanReviewStatusEnum.REJECTED.value
    report.human_reviewer = payload.reviewer
    report.human_notes = payload.notes
    await db.flush()
    await db.refresh(report)
    return report
