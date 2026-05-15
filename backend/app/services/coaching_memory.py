from __future__ import annotations

import re
from statistics import mean
from typing import Any

OPENING_KEYWORDS = (
    "sicilian",
    "french",
    "caro-kann",
    "ruy lopez",
    "italian",
    "scotch",
    "queen's gambit",
    "queens gambit",
    "king's indian",
    "nimzo",
    "london",
    "english",
    "pirc",
    "scandinavian",
    "slav",
    "grunfeld",
)

RETREAT_MOVE_PATTERN = re.compile(r"^[KQRBN][a-h][1278](?:[+#])?$")


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def _as_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _as_int(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _first_solution_token(item: dict[str, Any]) -> str | None:
    solution_lines = item.get("solutionLines")
    if not isinstance(solution_lines, list) or not solution_lines:
        return None
    first_line = solution_lines[0]
    if not isinstance(first_line, str):
        return None
    parts = [token.strip() for token in first_line.split() if token.strip()]
    if not parts:
        return None
    return parts[0]


def _compute_streak(results: list[bool], *, target: bool) -> int:
    count = 0
    for value in results:
        if value is target:
            count += 1
            continue
        break
    return count


def _recent(values: list[float], start: int, size: int) -> list[float]:
    return values[start : start + size]


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return float(mean(values))


def _preferred_response_length(user_message: str) -> str:
    lowered = user_message.lower()
    if any(token in lowered for token in ("concise", "short", "quick", "brief")):
        return "concise"
    if any(token in lowered for token in ("detail", "detailed", "deeper", "thorough")):
        return "detailed"
    return "balanced"


def _preferred_coaching_style(user_message: str) -> str:
    lowered = user_message.lower()
    if any(token in lowered for token in ("direct", "blunt", "straight")):
        return "direct"
    if any(token in lowered for token in ("gentle", "encourag", "supportive")):
        return "encouraging"
    return "balanced"


def _hint_preference(user_message: str) -> str:
    lowered = user_message.lower()
    if "hint 1" in lowered or "small hint" in lowered or "light hint" in lowered:
        return "light"
    if "hint 3" in lowered or "full line" in lowered or "just tell me" in lowered:
        return "direct"
    return "progressive"


def _aggression_level(user_message: str) -> str:
    lowered = user_message.lower()
    if any(
        token in lowered
        for token in ("attack", "aggressive", "sac", "crush", "initiative")
    ):
        return "high"
    if any(token in lowered for token in ("solid", "calm", "endgame", "positional")):
        return "low"
    return "medium"


def build_conversational_memory(
    *,
    history: list[dict[str, Any]] | None,
    user_message: str | None = None,
) -> dict[str, Any]:
    items = [item for item in (history or []) if isinstance(item, dict)]
    message = (user_message or "").strip()

    correctness: list[bool] = []
    statuses: list[str] = []
    ratings: list[int] = []
    vision_confidence: list[float] = []
    solve_times_ms: list[int] = []
    time_to_first_move_seconds: list[float] = []
    attempts_used: list[int] = []
    opening_counts: dict[str, int] = {}
    retreat_miss_count = 0
    knight_success_count = 0
    knight_total_count = 0
    fast_wrong_count = 0
    hard_correct_count = 0

    for item in items:
        first_move_correct = _as_bool(item.get("firstMoveCorrect"))
        if first_move_correct is not None:
            correctness.append(first_move_correct)

        status = item.get("firstMoveStatus")
        if isinstance(status, str) and status.strip():
            statuses.append(status.strip().lower())

        rating = (
            _as_int(item.get("difficultyRating"))
            or _as_int(item.get("puzzleElo"))
            or _as_int(item.get("estimatedDifficultyRating"))
        )
        if rating is not None:
            ratings.append(rating)

        confidence = _as_float(item.get("visionConfidence"))
        if confidence is not None:
            vision_confidence.append(max(0.0, min(1.0, confidence)))

        solve_time = _as_int(item.get("solveTimeMs"))
        if solve_time is not None and solve_time >= 0:
            solve_times_ms.append(solve_time)

        first_move_seconds = _as_float(item.get("timeToFirstMoveSeconds"))
        if first_move_seconds is not None and first_move_seconds >= 0:
            time_to_first_move_seconds.append(first_move_seconds)

        attempts = _as_int(item.get("attemptsUsed"))
        if attempts is not None and attempts >= 0:
            attempts_used.append(attempts)

        text_blob = " ".join(
            [
                str(item.get("fileName", "")),
                str(item.get("puzzleId", "")),
            ]
        ).lower()
        for keyword in OPENING_KEYWORDS:
            if keyword in text_blob:
                opening_counts[keyword] = opening_counts.get(keyword, 0) + 1

        first_token = _first_solution_token(item)
        if first_token and first_token.startswith("N"):
            knight_total_count += 1
            if first_move_correct is True:
                knight_success_count += 1

        if (
            first_move_correct is False
            and first_token
            and RETREAT_MOVE_PATTERN.match(first_token)
        ):
            retreat_miss_count += 1

        is_fast = False
        if solve_time is not None and solve_time <= 12000:
            is_fast = True
        elif first_move_seconds is not None and first_move_seconds <= 8:
            is_fast = True
        if first_move_correct is False and is_fast:
            fast_wrong_count += 1

        if first_move_correct is True and rating is not None and rating >= 1700:
            hard_correct_count += 1

    correct_streak = _compute_streak(correctness, target=True)
    fail_streak = _compute_streak(correctness, target=False)

    recent_correct = correctness[:6]
    previous_correct = correctness[6:12]
    recent_accuracy = (
        (sum(1 for value in recent_correct if value) / len(recent_correct))
        if recent_correct
        else None
    )
    previous_accuracy = (
        (sum(1 for value in previous_correct if value) / len(previous_correct))
        if previous_correct
        else None
    )
    accuracy_delta = (
        (recent_accuracy - previous_accuracy)
        if recent_accuracy is not None and previous_accuracy is not None
        else None
    )

    recent_conf_avg = _average(_recent(vision_confidence, 0, 5))
    previous_conf_avg = _average(_recent(vision_confidence, 5, 5))
    confidence_delta = (
        (recent_conf_avg - previous_conf_avg)
        if recent_conf_avg is not None and previous_conf_avg is not None
        else None
    )

    recent_solve_avg = _average([float(v) for v in _recent(solve_times_ms, 0, 5)])
    previous_solve_avg = _average([float(v) for v in _recent(solve_times_ms, 5, 5)])
    solve_speed_delta_ms = (
        (recent_solve_avg - previous_solve_avg)
        if recent_solve_avg is not None and previous_solve_avg is not None
        else None
    )
    recent_attempts_avg = _average([float(v) for v in _recent(attempts_used, 0, 5)])

    favorite_openings = [
        key
        for key, _count in sorted(
            opening_counts.items(), key=lambda pair: pair[1], reverse=True
        )[:2]
    ]
    common_tactical_mistakes: list[str] = []
    if fast_wrong_count >= 2:
        common_tactical_mistakes.append("rushing forcing-move checks")
    if retreat_miss_count >= 2:
        common_tactical_mistakes.append("retreat move recognition")
    if statuses.count("almost_correct") >= 2:
        common_tactical_mistakes.append("final move precision")

    puzzle_strengths: list[str] = []
    puzzle_weaknesses: list[str] = []
    if (
        knight_total_count >= 2
        and (knight_success_count / max(1, knight_total_count)) >= 0.6
    ):
        puzzle_strengths.append("knight forks")
    if hard_correct_count >= 2:
        puzzle_strengths.append("high-difficulty conversion")
    if fail_streak >= 3:
        puzzle_weaknesses.append("consistency under pressure")
    if retreat_miss_count >= 2:
        puzzle_weaknesses.append("retreat moves")

    return {
        "favorite_openings": favorite_openings,
        "preferred_coaching_style": _preferred_coaching_style(message),
        "common_tactical_mistakes": common_tactical_mistakes,
        "preferred_response_length": _preferred_response_length(message),
        "puzzle_strengths": puzzle_strengths,
        "puzzle_weaknesses": puzzle_weaknesses,
        "aggression_level": _aggression_level(message),
        "hint_preference": _hint_preference(message),
        "signals": {
            "history_count": len(items),
            "correct_streak": correct_streak,
            "fail_streak": fail_streak,
            "recent_accuracy": recent_accuracy,
            "previous_accuracy": previous_accuracy,
            "accuracy_delta": accuracy_delta,
            "recent_confidence_avg": recent_conf_avg,
            "previous_confidence_avg": previous_conf_avg,
            "confidence_delta": confidence_delta,
            "recent_solve_avg_ms": recent_solve_avg,
            "previous_solve_avg_ms": previous_solve_avg,
            "solve_speed_delta_ms": solve_speed_delta_ms,
            "recent_attempts_avg": recent_attempts_avg,
            "hard_correct_count": hard_correct_count,
            "fast_wrong_count": fast_wrong_count,
            "latest_rating": ratings[0] if ratings else None,
            "latest_correct": correctness[0] if correctness else None,
        },
    }


def build_emotional_context(memory: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(memory, dict):
        return {"tone": "neutral", "cue": None, "pace": "normal"}
    signals = memory.get("signals")
    if not isinstance(signals, dict):
        return {"tone": "neutral", "cue": None, "pace": "normal"}

    fail_streak = int(signals.get("fail_streak") or 0)
    correct_streak = int(signals.get("correct_streak") or 0)
    hard_correct_count = int(signals.get("hard_correct_count") or 0)
    fast_wrong_count = int(signals.get("fast_wrong_count") or 0)
    accuracy_delta = signals.get("accuracy_delta")
    confidence_delta = signals.get("confidence_delta")
    latest_rating = signals.get("latest_rating")
    latest_correct = signals.get("latest_correct")

    if fast_wrong_count >= 2:
        return {
            "tone": "calm-correction",
            "cue": "You're rushing a little. Slow down and look for forcing moves first.",
            "pace": "slow",
        }
    if fail_streak >= 3:
        return {
            "tone": "encouraging",
            "cue": "Stay with it. We'll go slower and build the line one forcing move at a time.",
            "pace": "slow",
        }
    if (
        latest_correct is True
        and isinstance(latest_rating, int)
        and latest_rating >= 1700
        and hard_correct_count >= 1
    ):
        return {
            "tone": "impressed",
            "cue": "Most players miss that continuation. That was clean.",
            "pace": "normal",
        }
    if correct_streak >= 3:
        return {
            "tone": "confident-praise",
            "cue": "That was clean. Keep pressing with the same discipline.",
            "pace": "normal",
        }
    if isinstance(accuracy_delta, (int, float)) and accuracy_delta >= 0.15:
        return {
            "tone": "positive-trend",
            "cue": "Your pattern recognition is improving.",
            "pace": "normal",
        }
    if isinstance(confidence_delta, (int, float)) and confidence_delta <= -0.12:
        return {
            "tone": "reset",
            "cue": "Reset and take an extra beat before you commit to the first move.",
            "pace": "slow",
        }
    return {"tone": "neutral", "cue": None, "pace": "normal"}


def build_memory_reference(memory: dict[str, Any] | None) -> str | None:
    if not isinstance(memory, dict):
        return None
    strengths = memory.get("puzzle_strengths")
    weaknesses = memory.get("puzzle_weaknesses")
    response_length = memory.get("preferred_response_length")
    hint_preference = memory.get("hint_preference")
    mistakes = memory.get("common_tactical_mistakes")

    if isinstance(strengths, list) and "knight forks" in strengths:
        return "You usually spot knight forks quickly."
    if isinstance(weaknesses, list) and "retreat moves" in weaknesses:
        return "You tend to overlook retreat moves."
    if response_length == "concise":
        return "You prefer concise hints, so I'll keep this short."
    if hint_preference == "light":
        return "You usually do better with light nudges than full lines."
    if isinstance(mistakes, list) and mistakes:
        return f"Recent leak: {mistakes[0]}."
    return None


def build_prompt_memory_context(memory: dict[str, Any] | None) -> str:
    if not isinstance(memory, dict):
        return "(No conversational memory context.)"
    signals = memory.get("signals")
    if not isinstance(signals, dict):
        signals = {}

    favorite_openings = memory.get("favorite_openings") or []
    strengths = memory.get("puzzle_strengths") or []
    weaknesses = memory.get("puzzle_weaknesses") or []
    mistakes = memory.get("common_tactical_mistakes") or []
    lines = [
        f"preferred_coaching_style={memory.get('preferred_coaching_style')}",
        f"preferred_response_length={memory.get('preferred_response_length')}",
        f"hint_preference={memory.get('hint_preference')}",
        f"aggression_level={memory.get('aggression_level')}",
        f"favorite_openings={', '.join(favorite_openings) if favorite_openings else 'unknown'}",
        f"puzzle_strengths={', '.join(strengths) if strengths else 'none'}",
        f"puzzle_weaknesses={', '.join(weaknesses) if weaknesses else 'none'}",
        f"common_tactical_mistakes={', '.join(mistakes) if mistakes else 'none'}",
        f"correct_streak={signals.get('correct_streak', 0)}",
        f"fail_streak={signals.get('fail_streak', 0)}",
        f"accuracy_delta={signals.get('accuracy_delta')}",
        f"confidence_delta={signals.get('confidence_delta')}",
    ]
    return "\n".join(lines)


def build_prompt_emotional_context(emotional: dict[str, Any] | None) -> str:
    if not isinstance(emotional, dict):
        return "(No emotional context.)"
    tone = emotional.get("tone", "neutral")
    cue = emotional.get("cue") or "none"
    pace = emotional.get("pace", "normal")
    return f"tone={tone}\npace={pace}\nsuggested_cue={cue}"
