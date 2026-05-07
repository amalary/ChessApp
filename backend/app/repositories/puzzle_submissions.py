from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models_puzzle import LocalAuthPuzzleSubmission


@dataclass(frozen=True, slots=True)
class PuzzleSubmissionCreate:
    user_id: UUID
    file_name: str
    expected_side_to_move: str | None
    fen: str | None
    solve_time_ms: int | None
    puzzle_elo: int | None
    position_check: dict
    solution_lines: list[str]
    first_move_assessment: dict | None


def ensure_table(db: Session) -> None:
    LocalAuthPuzzleSubmission.__table__.create(bind=db.get_bind(), checkfirst=True)


def list_for_user(
    *,
    db: Session,
    user_id: UUID,
    limit: int,
) -> list[LocalAuthPuzzleSubmission]:
    rows = db.execute(
        select(LocalAuthPuzzleSubmission)
        .where(LocalAuthPuzzleSubmission.user_id == user_id)
        .order_by(LocalAuthPuzzleSubmission.created_at.desc())
        .limit(limit)
    ).scalars()
    return list(rows)


def create_submission(
    *,
    db: Session,
    payload: PuzzleSubmissionCreate,
) -> LocalAuthPuzzleSubmission:
    row = LocalAuthPuzzleSubmission(
        user_id=payload.user_id,
        file_name=payload.file_name,
        expected_side_to_move=payload.expected_side_to_move,
        fen=payload.fen,
        solve_time_ms=payload.solve_time_ms,
        puzzle_elo=payload.puzzle_elo,
        position_check=payload.position_check,
        solution_lines=payload.solution_lines,
        first_move_assessment=payload.first_move_assessment,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

