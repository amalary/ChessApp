"""Puzzle context builder for Amy's puzzle-aware coaching prompts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def _safe_getattr(obj: Any, name: str) -> Any:
    try:
        return getattr(obj, name)
    except Exception:
        return None


def _safe_get_value(source: Any, key: str) -> Any:
    if source is None:
        return None
    if isinstance(source, Mapping):
        return source.get(key)
    return _safe_getattr(source, key)


def _candidate_sources(puzzle: Any) -> list[Any]:
    sources: list[Any] = []
    if puzzle is None:
        return sources
    sources.append(puzzle)
    for field_name in (
        "position_check",
        "positionCheck",
        "first_move_assessment",
        "firstMoveAssessment",
        "analysis",
        "metadata",
        "puzzle",
        "submission",
    ):
        nested = _safe_get_value(puzzle, field_name)
        if nested is not None:
            sources.append(nested)
    return sources


def _first_present(puzzle: Any, keys: Sequence[str]) -> Any:
    for source in _candidate_sources(puzzle):
        for key in keys:
            value = _safe_get_value(source, key)
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            return value
    return None


def _as_clean_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return None


def _as_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        normalized: list[str] = []
        for item in value:
            text = _as_clean_text(item)
            if text:
                normalized.append(text)
        return normalized
    text = _as_clean_text(value)
    return [text] if text else []


def _format_side_to_move(side_value: Any, fen: str | None) -> str:
    side_text = _as_clean_text(side_value)
    if side_text:
        lowered = side_text.lower()
        if lowered in {"w", "white"}:
            return "White"
        if lowered in {"b", "black"}:
            return "Black"
        return side_text

    if isinstance(fen, str):
        parts = fen.strip().split()
        if len(parts) > 1:
            if parts[1] == "w":
                return "White"
            if parts[1] == "b":
                return "Black"
    return "Unknown"


def _format_theme(value: Any) -> str:
    text = _as_clean_text(value)
    if text:
        return text

    themes = _as_string_list(value)
    if themes:
        return ", ".join(themes)
    return "Unknown"


def _format_best_line(value: Any) -> str:
    text = _as_clean_text(value)
    if text:
        return text

    line_moves = _as_string_list(value)
    if line_moves:
        return " ".join(line_moves)
    return "Unknown"


def _format_mate_depth(value: Any) -> str:
    mate_text = _as_clean_text(value)
    return mate_text or "Unknown"


def _format_time_spent(value: Any) -> str:
    if isinstance(value, int):
        if value < 0:
            return "Unknown"
        # Most persisted values are milliseconds.
        if value >= 1000:
            return f"{round(value / 1000, 2)}s ({value} ms)"
        return f"{value} ms"
    if isinstance(value, float):
        if value < 0:
            return "Unknown"
        return f"{round(value, 2)}s"
    text = _as_clean_text(value)
    return text or "Unknown"


def _resolve_incorrect_attempts(puzzle: Any) -> str:
    direct = _first_present(
        puzzle,
        (
            "incorrect_attempts",
            "incorrectAttempts",
            "failed_attempts",
            "failedAttempts",
            "wrong_attempts",
            "wrongAttempts",
        ),
    )
    if isinstance(direct, int):
        return str(max(0, direct))

    attempts_used = _first_present(puzzle, ("attempts_used", "attemptsUsed"))
    is_first_move_correct = _first_present(
        puzzle, ("isFirstMoveCorrect", "first_move_correct")
    )
    if isinstance(attempts_used, int):
        if isinstance(is_first_move_correct, bool):
            if is_first_move_correct:
                return str(max(0, attempts_used - 1))
            return str(max(1, attempts_used))
        return str(max(0, attempts_used))
    return "Unknown"


def _default_text(value: str | None) -> str:
    return value if value else "Unknown"


def build_puzzle_context_payload(puzzle: Any) -> dict[str, str]:
    """
    Build a normalized puzzle-context payload for prompt and analytics layers.

    This function is intentionally data-only and does not call any model.
    """
    fen = _as_clean_text(_first_present(puzzle, ("fen", "FEN")))
    side = _first_present(
        puzzle,
        (
            "side_to_move",
            "sideToMove",
            "expected_side_to_move",
            "expectedSideToMove",
        ),
    )
    difficulty = _as_clean_text(
        _first_present(
            puzzle,
            (
                "puzzle_difficulty",
                "difficulty",
                "difficulty_rating",
                "difficultyRating",
                "estimated_difficulty_rating",
                "estimatedDifficultyRating",
                "puzzle_elo",
                "puzzleElo",
            ),
        )
    )
    theme = _first_present(puzzle, ("theme", "puzzle_theme", "theme_tags", "themes"))
    best_line = _first_present(
        puzzle,
        (
            "stockfish_best_line",
            "stockfishBestLine",
            "best_line",
            "bestLine",
            "solution_lines",
            "solutionLines",
        ),
    )
    mate_depth = _first_present(
        puzzle,
        (
            "mate_depth",
            "mateDepth",
            "mate_in",
            "mateIn",
            "stockfish_mate_depth",
            "stockfishMateDepth",
        ),
    )
    submitted_moves = _first_present(
        puzzle,
        (
            "user_submitted_moves",
            "userSubmittedMoves",
            "submitted_moves",
            "submittedMoves",
            "solver_line",
            "solverLine",
            "attempted_moves",
            "attemptedMoves",
        ),
    )
    time_spent = _first_present(
        puzzle,
        (
            "time_spent",
            "timeSpent",
            "solve_time_ms",
            "solveTimeMs",
            "time_to_first_move_seconds",
            "timeToFirstMoveSeconds",
        ),
    )
    source_image = _as_clean_text(
        _first_present(
            puzzle,
            (
                "puzzle_source_image_reference",
                "puzzleSourceImageReference",
                "original_puzzle_image_data_url",
                "originalPuzzleImageDataUrl",
                "source_image",
                "sourceImage",
                "image_ref",
                "imageRef",
            ),
        )
    )

    submitted_moves_line = _as_clean_text(submitted_moves)
    if submitted_moves_line is None:
        submitted_moves_line = " ".join(_as_string_list(submitted_moves))

    return {
        "fen": _default_text(fen),
        "side_to_move": _format_side_to_move(side, fen),
        "puzzle_difficulty": _default_text(difficulty),
        "puzzle_theme": _format_theme(theme),
        "stockfish_best_line": _format_best_line(best_line),
        "mate_depth": _format_mate_depth(mate_depth),
        "user_submitted_moves": _default_text(submitted_moves_line),
        "incorrect_attempts": _resolve_incorrect_attempts(puzzle),
        "time_spent": _format_time_spent(time_spent),
        "source_image_reference": _default_text(source_image),
    }


def build_puzzle_context(puzzle: Any) -> str:
    """
    Build structured puzzle context text for Amy.

    Output shape:
    CURRENT PUZZLE:
    FEN: ...
    Side To Move: ...
    Puzzle Difficulty: ...
    Theme: ...
    Mate In: ...
    Best Line: ...
    User Submitted Moves: ...
    Incorrect Attempts: ...
    Time Spent: ...
    Source Image Ref: ...
    """
    payload = build_puzzle_context_payload(puzzle)
    lines = [
        "CURRENT PUZZLE:",
        f"FEN: {payload['fen']}",
        f"Side To Move: {payload['side_to_move']}",
        f"Puzzle Difficulty: {payload['puzzle_difficulty']}",
        f"Theme: {payload['puzzle_theme']}",
        f"Mate In: {payload['mate_depth']}",
        f"Best Line: {payload['stockfish_best_line']}",
        f"User Submitted Moves: {payload['user_submitted_moves']}",
        f"Incorrect Attempts: {payload['incorrect_attempts']}",
        f"Time Spent: {payload['time_spent']}",
        f"Source Image Ref: {payload['source_image_reference']}",
    ]
    return "\n".join(lines)
