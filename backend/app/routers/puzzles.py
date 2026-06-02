from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db_auth import get_db
from app.local_auth_user import get_required_local_auth_user_from_auth0_sub
from app.models_auth import LocalAuthUser
from app.services.puzzle_submission_service import (
    DifficultyBucketAnalyticsResponse,
    PuzzleSubmissionResponse,
    get_difficulty_bucket_analytics_for_user,
    list_submissions_for_user,
)

router = APIRouter(prefix="/puzzles", tags=["puzzles"])


@router.get("/submissions", response_model=list[PuzzleSubmissionResponse])
def list_puzzle_submissions(
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: LocalAuthUser = Depends(get_required_local_auth_user_from_auth0_sub),
):
    return list_submissions_for_user(db=db, current_user=current_user, limit=limit)


@router.get(
    "/analytics/difficulty-buckets",
    response_model=DifficultyBucketAnalyticsResponse,
)
def get_difficulty_bucket_analytics(
    db: Session = Depends(get_db),
    current_user: LocalAuthUser = Depends(get_required_local_auth_user_from_auth0_sub),
):
    return get_difficulty_bucket_analytics_for_user(db=db, current_user=current_user)
