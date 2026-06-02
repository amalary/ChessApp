"""User profile context builder for personalized Amy coaching responses."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def _safe_getattr(obj: Any, name: str) -> Any:
    """Read an attribute safely without raising from missing/invalid fields."""
    try:
        return getattr(obj, name)
    except Exception:
        return None


def _safe_get_value(source: Any, key: str) -> Any:
    """Read a key or attribute from a source object safely."""
    if source is None:
        return None
    if isinstance(source, Mapping):
        return source.get(key)
    return _safe_getattr(source, key)


def _candidate_sources(user: Any) -> list[Any]:
    """Return likely profile containers to search for user fields."""
    sources: list[Any] = []
    if user is None:
        return sources
    sources.append(user)

    for field_name in (
        "profile",
        "preferences",
        "training_profile",
        "coaching_profile",
        "metadata",
        "stats",
    ):
        nested = _safe_get_value(user, field_name)
        if nested is not None:
            sources.append(nested)
    return sources


def _first_present(user: Any, keys: Sequence[str]) -> Any:
    """Return the first non-empty value found among candidate keys."""
    for source in _candidate_sources(user):
        for key in keys:
            value = _safe_get_value(source, key)
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            return value
    return None


def _format_scalar(value: Any) -> str | None:
    """Convert simple values to a clean single-line string."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    return None


def _normalize_string_list(value: Any) -> list[str]:
    """Normalize a scalar or sequence into a list of non-empty strings."""
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        normalized: list[str] = []
        for item in value:
            text = _format_scalar(item)
            if text:
                normalized.append(text)
        return normalized
    text = _format_scalar(value)
    return [text] if text else []


def _format_difficulty_range(value: Any) -> str | None:
    """Format a preferred difficulty range from common range shapes."""
    text = _format_scalar(value)
    if text:
        return text

    if isinstance(value, Mapping):
        min_value = None
        max_value = None
        for key in ("min", "minimum", "low", "from", "start"):
            min_value = value.get(key)
            if min_value is not None:
                break
        for key in ("max", "maximum", "high", "to", "end"):
            max_value = value.get(key)
            if max_value is not None:
                break
        min_text = _format_scalar(min_value)
        max_text = _format_scalar(max_value)
        if min_text and max_text:
            return f"{min_text}-{max_text}"
        if min_text:
            return f"{min_text}+"
        if max_text:
            return f"up to {max_text}"
    elif isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        parts = _normalize_string_list(value)
        if len(parts) >= 2:
            return f"{parts[0]}-{parts[1]}"
        if len(parts) == 1:
            return parts[0]
    return None


def _format_puzzle_summary(value: Any) -> str | None:
    """Format puzzle performance summary text from strings, lists, or maps."""
    text = _format_scalar(value)
    if text:
        return text

    if isinstance(value, Mapping):
        summary = _format_scalar(value.get("summary"))
        if summary:
            return summary

        accuracy = _format_scalar(
            value.get("accuracy") or value.get("first_move_accuracy")
        )
        avg_rating = _format_scalar(
            value.get("average_rating") or value.get("avg_rating")
        )
        solved = _format_scalar(value.get("solved") or value.get("solved_count"))

        parts: list[str] = []
        if accuracy:
            parts.append(f"accuracy {accuracy}")
        if avg_rating:
            parts.append(f"avg rating {avg_rating}")
        if solved:
            parts.append(f"solved {solved}")
        if parts:
            return ", ".join(parts)
        return None

    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        parts = _normalize_string_list(value)
        if parts:
            return " | ".join(parts)
    return None


def build_user_profile_context(user: Any) -> str:
    """
    Build structured text profile context for Amy personalization.

    The output starts with ``USER PROFILE:`` and includes only fields that
    are present. Missing attributes are ignored to avoid runtime failures.
    """
    lines: list[str] = ["USER PROFILE:"]

    elo = _format_scalar(
        _first_present(user, ("elo", "user_elo", "rating", "chess_rating"))
    )
    if elo:
        lines.append(f"ELO: {elo}")

    preferred_style = _format_scalar(
        _first_present(
            user,
            (
                "preferred_explanation_style",
                "preferred_style",
                "explanation_style",
                "coaching_style",
                "preferred_coaching_style",
            ),
        )
    )
    if preferred_style:
        lines.append(f"Preferred Style: {preferred_style}")

    openings = _normalize_string_list(
        _first_present(
            user,
            (
                "favorite_openings",
                "preferred_openings",
                "openings",
            ),
        )
    )
    if openings:
        lines.append(f"Favorite Openings: {', '.join(openings)}")

    training_goals = _normalize_string_list(
        _first_present(
            user,
            (
                "training_goals",
                "training_goal",
                "goals",
                "goal",
            ),
        )
    )
    if training_goals:
        lines.append(f"Training Goal: {', '.join(training_goals)}")

    weaknesses = _normalize_string_list(
        _first_present(
            user,
            (
                "common_tactical_weaknesses",
                "tactical_weaknesses",
                "puzzle_weaknesses",
                "weaknesses",
            ),
        )
    )
    if weaknesses:
        lines.append(f"Common Tactical Weaknesses: {', '.join(weaknesses)}")

    difficulty_range = _format_difficulty_range(
        _first_present(
            user,
            (
                "preferred_difficulty_range",
                "difficulty_range",
                "preferred_rating_range",
            ),
        )
    )
    if difficulty_range:
        lines.append(f"Preferred Difficulty Range: {difficulty_range}")

    puzzle_summary = _format_puzzle_summary(
        _first_present(
            user,
            (
                "puzzle_performance_summaries",
                "puzzle_performance_summary",
                "performance_summary",
                "puzzle_performance",
            ),
        )
    )
    if puzzle_summary:
        lines.append(f"Puzzle Performance Summary: {puzzle_summary}")

    return "\n".join(lines)
