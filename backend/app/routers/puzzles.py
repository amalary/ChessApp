from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db_auth import get_db
from app.local_auth_user import get_required_local_auth_user
from app.models_auth import LocalAuthUser
from app.services.puzzle_submission_service import (
    PuzzleSubmissionResponse,
    list_submissions_for_user,
)

router = APIRouter(prefix="/puzzles", tags=["puzzles"])


@router.get("/submissions", response_model=list[PuzzleSubmissionResponse])
def list_puzzle_submissions(
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: LocalAuthUser = Depends(get_required_local_auth_user),
):
    return list_submissions_for_user(db=db, current_user=current_user, limit=limit)
