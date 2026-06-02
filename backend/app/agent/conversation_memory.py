"""Recent conversation memory builder for Amy chat prompts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import re
from typing import Any

WHITESPACE_PATTERN = re.compile(r"\s+")


@dataclass(frozen=True)
class ConversationMemoryConfig:
    """Configurable knobs for short-term conversation memory strategy."""

    min_messages: int = 5
    max_messages: int = 10
    max_chars_total: int = 1800
    max_chars_per_message: int = 240
    max_puzzle_messages: int = 4
    include_puzzle_summary: bool = True
    puzzle_keywords: tuple[str, ...] = (
        "puzzle",
        "fen",
        "mate",
        "tactic",
        "stockfish",
        "line",
        "blunder",
        "opening",
        "endgame",
        "move",
        "queen",
        "rook",
        "bishop",
        "knight",
        "pawn",
        "check",
        "checkmate",
    )


DEFAULT_CONVERSATION_MEMORY_CONFIG = ConversationMemoryConfig()


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


def _normalize_text(value: Any) -> str:
    text = WHITESPACE_PATTERN.sub(" ", str(value or "")).strip()
    return text


def _to_role_label(raw_role: Any) -> str | None:
    role = _normalize_text(raw_role).lower()
    if not role:
        return None
    if role in {"user", "human", "player"}:
        return "User"
    if role in {"assistant", "amy", "bot", "model"}:
        return "Amy"
    return None


def _extract_message_text(message: Any) -> str:
    for key in ("content", "text", "message", "value"):
        value = _safe_get_value(message, key)
        if value is None:
            continue
        if isinstance(value, Sequence) and not isinstance(
            value, (str, bytes, bytearray)
        ):
            chunks: list[str] = []
            for item in value:
                if isinstance(item, Mapping):
                    chunk = _safe_get_value(item, "text")
                    if chunk is None:
                        chunk = _safe_get_value(item, "content")
                    if chunk is None:
                        continue
                    chunks.append(str(chunk))
                else:
                    chunks.append(str(item))
            joined = _normalize_text(" ".join(chunks))
            if joined:
                return joined
        else:
            text = _normalize_text(value)
            if text:
                return text
    return ""


def _normalize_messages(messages: Any) -> list[dict[str, str]]:
    if not isinstance(messages, Sequence) or isinstance(
        messages, (str, bytes, bytearray)
    ):
        return []

    normalized: list[dict[str, str]] = []
    for item in messages:
        role_label = _to_role_label(_safe_get_value(item, "role"))
        if not role_label:
            continue
        text = _extract_message_text(item)
        if not text:
            continue
        normalized.append({"role": role_label, "text": text})
    return normalized


def _truncate_message(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    if max_chars <= 3:
        return text[:max_chars]
    return text[: max_chars - 3].rstrip() + "..."


def _is_puzzle_message(text: str, keywords: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in keywords)


def _message_lines(messages: list[dict[str, str]]) -> list[str]:
    return [f"{item['role']}: {item['text']}" for item in messages]


def _render_within_budget(
    selected: list[dict[str, str]],
    puzzle_selected: list[dict[str, str]],
    config: ConversationMemoryConfig,
) -> str:
    current = [
        {"role": item["role"], "text": _truncate_message(item["text"], config.max_chars_per_message)}
        for item in selected
    ]

    while current:
        lines = ["RECENT CONVERSATION:", *_message_lines(current)]
        if config.include_puzzle_summary and puzzle_selected:
            lines.append("")
            lines.append("RECENT PUZZLE DISCUSSION:")
            lines.extend(_message_lines(puzzle_selected))
        result = "\n".join(lines)
        if len(result) <= config.max_chars_total:
            return result

        if len(current) > 1:
            current.pop(0)
            continue

        tighter_limit = max(40, config.max_chars_per_message // 2)
        current[0]["text"] = _truncate_message(current[0]["text"], tighter_limit)
        puzzle_selected = []

    return "RECENT CONVERSATION:\n(No recent conversation.)"


def build_recent_conversation_context(messages: Any) -> str:
    """
    Build bounded short-term conversation memory for Amy prompts.

    Strategy:
    - Keep a recent rolling window (default 5-10 messages).
    - Include both User and Amy turns.
    - Add a compact recent puzzle discussion section when available.
    - Enforce strict truncation and total character budget.

    The strategy is configurable via ``DEFAULT_CONVERSATION_MEMORY_CONFIG``.
    """
    config = DEFAULT_CONVERSATION_MEMORY_CONFIG
    normalized = _normalize_messages(messages)
    if not normalized:
        return "RECENT CONVERSATION:\n(No recent conversation.)"

    recent_window = normalized[-config.max_messages :]
    if len(recent_window) < config.min_messages and len(normalized) > len(recent_window):
        needed = config.min_messages - len(recent_window)
        prefix = normalized[max(0, len(normalized) - config.max_messages - needed) : -config.max_messages]
        recent_window = [*prefix, *recent_window]

    puzzle_turns = [
        item
        for item in reversed(recent_window)
        if _is_puzzle_message(item["text"], config.puzzle_keywords)
    ]
    puzzle_turns = list(reversed(puzzle_turns[: config.max_puzzle_messages]))

    return _render_within_budget(recent_window, puzzle_turns, config)
