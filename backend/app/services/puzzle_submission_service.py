from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models_auth import LocalAuthUser
from app.models_puzzle import LocalAuthPuzzleSubmission
from app.repositories import puzzle_submissions
from app.repositories.puzzle_submissions import PuzzleSubmissionCreate


class PuzzleSubmissionResponse(BaseModel):
    id: str
    fileName: str
    submittedAt: str
    expectedSideToMove: str
    fen: str | None
    solveTimeMs: int | None
    puzzleElo: int | None
    originalPuzzleImageDataUrl: str | None = None
    positionCheck: dict[str, Any]
    solutionLines: list[str]
    firstMoveAssessment: dict[str, Any] | None = None


def _normalize_position_check(raw: dict[str, Any] | None) -> dict[str, Any]:
    payload = raw or {}
    side = payload.get("sideToMove")
    normalized_side = side if side in {"white", "black"} else None
    confidence = payload.get("confidence")
    attempts = payload.get("attemptsUsed")
    mate_found = payload.get("mateFound")
    mate_in = payload.get("mateIn")

    return {
        "sideToMove": normalized_side,
        "confidence": confidence if isinstance(confidence, (float, int)) else None,
        "attemptsUsed": attempts if isinstance(attempts, int) else None,
        "mateFound": mate_found if isinstance(mate_found, bool) else None,
        "mateIn": mate_in if isinstance(mate_in, int) else None,
    }


def map_submission(submission: LocalAuthPuzzleSubmission) -> PuzzleSubmissionResponse:
    created_at = submission.created_at or datetime.utcnow()
    expected_side = submission.expected_side_to_move
    if expected_side not in {"white", "black"}:
        expected_side = "white"

    return PuzzleSubmissionResponse(
        id=str(submission.id),
        fileName=submission.file_name,
        submittedAt=created_at.isoformat(),
        expectedSideToMove=expected_side,
        fen=submission.fen,
        solveTimeMs=submission.solve_time_ms,
        puzzleElo=submission.puzzle_elo,
        positionCheck=_normalize_position_check(submission.position_check),
        solutionLines=(
            submission.solution_lines if isinstance(submission.solution_lines, list) else []
        ),
        firstMoveAssessment=(
            submission.first_move_assessment
            if isinstance(submission.first_move_assessment, dict)
            else None
        ),
    )


def list_submissions_for_user(
    *,
    db: Session,
    current_user: LocalAuthUser,
    limit: int,
) -> list[PuzzleSubmissionResponse]:
    puzzle_submissions.ensure_table(db)
    rows = puzzle_submissions.list_for_user(db=db, user_id=current_user.id, limit=limit)
    return [map_submission(row) for row in rows]


def create_submission_for_user(
    *,
    db: Session,
    payload: PuzzleSubmissionCreate,
) -> LocalAuthPuzzleSubmission:
    puzzle_submissions.ensure_table(db)
    return puzzle_submissions.create_submission(db=db, payload=payload)

