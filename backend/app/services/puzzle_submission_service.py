from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import chess
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
    difficultyRating: int | None
    estimatedDifficultyRating: int | None
    originalPuzzleImageDataUrl: str | None = None
    positionCheck: dict[str, Any]
    solutionLines: list[str]
    firstMoveAssessment: dict[str, Any] | None = None


class DifficultyBucketAnalyticsEntry(BaseModel):
    label: str
    total_attempts: int
    correct_attempts: int
    accuracy_percentage: float
    average_solve_time_seconds: float | None


class DifficultyBucketAnalyticsResponse(BaseModel):
    difficulty_buckets: list[DifficultyBucketAnalyticsEntry]
    total_valid_attempts: int
    confidence_threshold: float


DIFFICULTY_BUCKETS: tuple[tuple[str, int, int | None], ...] = (
    ("0-800", 0, 800),
    ("800-1200", 800, 1200),
    ("1200-1600", 1200, 1600),
    ("1600-2000", 1600, 2000),
    ("2000+", 2000, None),
)
DEFAULT_DIFFICULTY_ANALYTICS_CONFIDENCE_THRESHOLD = 0.75


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


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


def _tokenize_moves(solution_lines: list[str]) -> int:
    return len([token for token in " ".join(solution_lines).split() if token.strip()])


def estimate_puzzle_difficulty_rating(
    *,
    solve_time_ms: int | None,
    mate_in: int | None,
    confidence: float | int | None,
    attempts_used: int | None,
    solution_lines: list[str],
) -> int:
    elo = 900
    move_tokens = _tokenize_moves(solution_lines)
    extra_move_complexity = max(0, move_tokens - 2)
    elo += min(420, extra_move_complexity * 55)

    if isinstance(mate_in, int):
        elo += max(0, mate_in - 1) * 150

    if isinstance(solve_time_ms, int):
        solve_seconds = solve_time_ms / 1000
        time_factor = max(0, solve_seconds - 15)
        elo += min(500, round(time_factor * 2.8))

    if isinstance(attempts_used, int):
        elo += max(0, attempts_used - 1) * 35

    if isinstance(confidence, (int, float)):
        normalized_confidence = max(0.0, min(1.0, float(confidence)))
        elo += round((1 - normalized_confidence) * 120)

    clamped = max(600, min(2600, elo))
    return round(clamped / 10) * 10


def _is_valid_fen(fen: str | None) -> bool:
    if not isinstance(fen, str) or not fen.strip():
        return False
    try:
        board = chess.Board(fen.strip())
    except Exception:
        return False
    return board.is_valid()


def _resolve_difficulty_rating(submission: LocalAuthPuzzleSubmission) -> int:
    difficulty_rating = getattr(submission, "difficulty_rating", None)
    estimated_difficulty_rating = getattr(
        submission, "estimated_difficulty_rating", None
    )
    puzzle_elo = getattr(submission, "puzzle_elo", None)

    if isinstance(difficulty_rating, int):
        return difficulty_rating
    if isinstance(estimated_difficulty_rating, int):
        return estimated_difficulty_rating
    if isinstance(puzzle_elo, int):
        return puzzle_elo

    position_check = _normalize_position_check(submission.position_check)
    return estimate_puzzle_difficulty_rating(
        solve_time_ms=submission.solve_time_ms,
        mate_in=position_check.get("mateIn"),
        confidence=position_check.get("confidence"),
        attempts_used=position_check.get("attemptsUsed"),
        solution_lines=(
            submission.solution_lines
            if isinstance(submission.solution_lines, list)
            else []
        ),
    )


def _find_bucket_label(rating: int) -> str:
    for label, minimum, maximum in DIFFICULTY_BUCKETS:
        if rating < minimum:
            continue
        if maximum is None or rating < maximum:
            return label
    return DIFFICULTY_BUCKETS[-1][0]


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _to_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def build_difficulty_bucket_analytics(
    *,
    rows: list[LocalAuthPuzzleSubmission],
    confidence_threshold: float | None = None,
) -> DifficultyBucketAnalyticsResponse:
    threshold = (
        confidence_threshold
        if confidence_threshold is not None
        else _env_float(
            "FIRST_MOVE_MIN_CONFIDENCE",
            DEFAULT_DIFFICULTY_ANALYTICS_CONFIDENCE_THRESHOLD,
        )
    )
    clamped_threshold = max(0.0, min(1.0, threshold))
    bucket_stats = {
        label: {"total": 0, "correct": 0, "solve_time_sum": 0.0, "solve_time_count": 0}
        for label, _, _ in DIFFICULTY_BUCKETS
    }
    total_valid_attempts = 0

    for submission in rows:
        first_move_assessment = (
            submission.first_move_assessment
            if isinstance(submission.first_move_assessment, dict)
            else None
        )
        if first_move_assessment is None:
            continue
        if first_move_assessment.get("isValidForFirstMoveAccuracy") is False:
            continue
        is_first_move_correct = _to_bool(
            first_move_assessment.get("isFirstMoveCorrect")
        )
        if is_first_move_correct is None:
            continue

        if not _is_valid_fen(submission.fen):
            continue

        position_check = _normalize_position_check(submission.position_check)
        if position_check.get("mateFound") is not True:
            continue
        confidence = _to_float(position_check.get("confidence"))
        if confidence is None or confidence < clamped_threshold:
            continue
        if (
            not isinstance(submission.solution_lines, list)
            or len(submission.solution_lines) == 0
        ):
            continue

        rating = _resolve_difficulty_rating(submission)
        bucket_label = _find_bucket_label(rating)
        stats = bucket_stats[bucket_label]
        stats["total"] += 1
        if is_first_move_correct:
            stats["correct"] += 1

        solve_time_ms = submission.solve_time_ms
        if isinstance(solve_time_ms, int) and solve_time_ms >= 0:
            stats["solve_time_sum"] += solve_time_ms / 1000
            stats["solve_time_count"] += 1
        total_valid_attempts += 1

    difficulty_buckets = []
    for label, _, _ in DIFFICULTY_BUCKETS:
        stats = bucket_stats[label]
        total_attempts = int(stats["total"])
        correct_attempts = int(stats["correct"])
        accuracy_percentage = (
            round((correct_attempts / total_attempts) * 100, 2)
            if total_attempts > 0
            else 0.0
        )
        average_solve_time_seconds = (
            round(stats["solve_time_sum"] / stats["solve_time_count"], 2)
            if stats["solve_time_count"] > 0
            else None
        )
        difficulty_buckets.append(
            DifficultyBucketAnalyticsEntry(
                label=label,
                total_attempts=total_attempts,
                correct_attempts=correct_attempts,
                accuracy_percentage=accuracy_percentage,
                average_solve_time_seconds=average_solve_time_seconds,
            )
        )

    return DifficultyBucketAnalyticsResponse(
        difficulty_buckets=difficulty_buckets,
        total_valid_attempts=total_valid_attempts,
        confidence_threshold=round(clamped_threshold, 4),
    )


def map_submission(submission: LocalAuthPuzzleSubmission) -> PuzzleSubmissionResponse:
    created_at = submission.created_at or datetime.utcnow()
    expected_side = submission.expected_side_to_move
    if expected_side not in {"white", "black"}:
        expected_side = "white"
    original_image_data_url = getattr(
        submission, "original_puzzle_image_data_url", None
    )
    if not isinstance(original_image_data_url, str):
        original_image_data_url = None

    return PuzzleSubmissionResponse(
        id=str(submission.id),
        fileName=submission.file_name,
        submittedAt=created_at.isoformat(),
        expectedSideToMove=expected_side,
        fen=submission.fen,
        solveTimeMs=submission.solve_time_ms,
        puzzleElo=_resolve_difficulty_rating(submission),
        difficultyRating=getattr(submission, "difficulty_rating", None),
        estimatedDifficultyRating=(
            getattr(submission, "estimated_difficulty_rating", None)
            if isinstance(getattr(submission, "estimated_difficulty_rating", None), int)
            else (
                submission.puzzle_elo
                if isinstance(submission.puzzle_elo, int)
                else _resolve_difficulty_rating(submission)
            )
        ),
        originalPuzzleImageDataUrl=original_image_data_url,
        positionCheck=_normalize_position_check(submission.position_check),
        solutionLines=(
            submission.solution_lines
            if isinstance(submission.solution_lines, list)
            else []
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


def get_difficulty_bucket_analytics_for_user(
    *,
    db: Session,
    current_user: LocalAuthUser,
    limit: int = 1000,
) -> DifficultyBucketAnalyticsResponse:
    puzzle_submissions.ensure_table(db)
    rows = puzzle_submissions.list_for_user(db=db, user_id=current_user.id, limit=limit)
    return build_difficulty_bucket_analytics(rows=rows)


def build_submission_history_context_for_user(
    *,
    db: Session,
    current_user: LocalAuthUser,
    limit: int = 200,
) -> list[dict[str, Any]]:
    submissions = list_submissions_for_user(
        db=db,
        current_user=current_user,
        limit=max(1, min(limit, 500)),
    )
    context: list[dict[str, Any]] = []
    for submission in submissions:
        position_check = submission.positionCheck or {}
        first_move_assessment = submission.firstMoveAssessment or {}
        context.append(
            {
                "id": submission.id,
                "fileName": submission.fileName,
                "submittedAt": submission.submittedAt,
                "fen": submission.fen,
                "solveTimeMs": submission.solveTimeMs,
                "puzzleElo": submission.puzzleElo,
                "difficultyRating": submission.difficultyRating,
                "estimatedDifficultyRating": submission.estimatedDifficultyRating,
                "mateIn": position_check.get("mateIn"),
                "visionConfidence": position_check.get("confidence"),
                "attemptsUsed": position_check.get("attemptsUsed"),
                "firstMoveCorrect": first_move_assessment.get("isFirstMoveCorrect"),
                "firstMoveStatus": first_move_assessment.get("status"),
                "timeToFirstMoveSeconds": first_move_assessment.get(
                    "timeToFirstMoveSeconds"
                ),
                "puzzleId": first_move_assessment.get("puzzleId"),
                "solutionLines": submission.solutionLines,
            }
        )
    return context
