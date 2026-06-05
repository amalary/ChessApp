"""Final context assembly pipeline for Amy assistant prompts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import logging
import re
from typing import Any

from app.agent.conversation_memory import build_recent_conversation_context
from app.agent.profile_context import build_user_profile_context
from app.agent.puzzle_context import build_puzzle_context
from app.agent.system_prompt import get_system_prompt

logger = logging.getLogger(__name__)

_DEFAULT_EMPTY_DOCS = "(No relevant documentation retrieved.)"
_DEFAULT_EMPTY_MESSAGE = "(No user message provided.)"
_WHITESPACE_PATTERN = re.compile(r"\s+")

_SECRET_FIELD_KEYWORDS = (
    "password",
    "passphrase",
    "secret",
    "token",
    "api_key",
    "apikey",
    "credential",
    "private_key",
    "access_key",
    "refresh_token",
    "session",
    "cookie",
    "hash",
    "salt",
    "database_url",
)


@dataclass(frozen=True)
class ContextBuilderLimits:
    """Character and item budgets to keep context bounded and predictable."""

    max_total_chars: int = 16_000
    max_system_chars: int = 3_200
    max_engine_analysis_chars: int = 1_800
    max_puzzle_chars: int = 2_600
    max_docs_chars: int = 4_000
    max_profile_chars: int = 2_000
    max_conversation_chars: int = 2_500
    max_user_message_chars: int = 1_000
    max_doc_chunks: int = 5
    max_doc_chunk_chars: int = 700


DEFAULT_CONTEXT_LIMITS = ContextBuilderLimits()


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


def _candidate_sources(value: Any, nested_fields: Sequence[str]) -> list[Any]:
    sources: list[Any] = []
    if value is None:
        return sources
    sources.append(value)
    for field_name in nested_fields:
        nested = _safe_get_value(value, field_name)
        if nested is not None:
            sources.append(nested)
    return sources


def _clean_text(value: Any) -> str:
    return _WHITESPACE_PATTERN.sub(" ", str(value or "")).strip()


def _clean_multiline_text(value: Any) -> str:
    raw = str(value or "")
    lines = [line.strip() for line in raw.splitlines()]
    compact = "\n".join(line for line in lines if line)
    return compact.strip()


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    if max_chars <= 3:
        return text[:max_chars]
    return text[: max_chars - 3].rstrip() + "..."


def _enforce_section_limit(text: str, max_chars: int) -> str:
    clean = _clean_multiline_text(text)
    if not clean:
        return ""
    return _truncate(clean, max_chars)


def _first_non_empty(
    value: Any, keys: Sequence[str], nested_fields: Sequence[str]
) -> Any:
    for source in _candidate_sources(value, nested_fields):
        for key in keys:
            found = _safe_get_value(source, key)
            if found is None:
                continue
            if isinstance(found, str) and not found.strip():
                continue
            return found
    return None


def _normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = _clean_text(value)
        return [text] if text else []
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        rows: list[str] = []
        for item in value:
            text = _clean_text(item)
            if text:
                rows.append(text)
        return rows
    text = _clean_text(value)
    return [text] if text else []


def _to_safe_lines(text: str) -> list[str]:
    if not text:
        return []
    return [line.rstrip() for line in text.splitlines() if line.strip()]


def _extract_engine_analysis(puzzle: Any, limits: ContextBuilderLimits) -> str:
    raw = _first_non_empty(
        puzzle,
        keys=(
            "engine_analysis",
            "engineAnalysis",
            "analysis",
            "stockfish_analysis",
            "stockfishAnalysis",
            "evaluation_summary",
            "evalSummary",
        ),
        nested_fields=(
            "analysis",
            "position_check",
            "positionCheck",
            "first_move_assessment",
            "firstMoveAssessment",
            "metadata",
            "puzzle",
            "submission",
        ),
    )

    if raw is None:
        return "(No engine analysis provided.)"

    if isinstance(raw, Mapping):
        rows: list[str] = []
        for key in (
            "best_move",
            "bestMove",
            "score",
            "cp",
            "mate",
            "depth",
            "principal_variation",
            "principalVariation",
            "line",
            "summary",
        ):
            value = raw.get(key)
            text = _clean_text(value)
            if text:
                rows.append(f"{key}: {text}")
        if rows:
            return _enforce_section_limit(
                "\n".join(rows), limits.max_engine_analysis_chars
            )

    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes, bytearray)):
        as_lines = _normalize_string_list(raw)
        text = "\n".join(as_lines) if as_lines else ""
        if text:
            return _enforce_section_limit(text, limits.max_engine_analysis_chars)

    return (
        _enforce_section_limit(_clean_text(raw), limits.max_engine_analysis_chars)
        or "(No engine analysis provided.)"
    )


def _extract_doc_chunks_from_source(source: Any) -> list[dict[str, str]]:
    chunks: list[dict[str, str]] = []
    if source is None:
        return chunks

    normalized: list[Any] = []
    if isinstance(source, Mapping):
        normalized = [source]
    elif isinstance(source, Sequence) and not isinstance(
        source, (str, bytes, bytearray)
    ):
        normalized = [item for item in source]
    else:
        return chunks

    for item in normalized:
        if not isinstance(item, Mapping):
            text = _clean_text(item)
            if text:
                chunks.append({"text": text, "source": ""})
            continue

        text = _clean_text(
            item.get("chunk_text")
            or item.get("text")
            or item.get("content")
            or item.get("documentation")
            or item.get("body")
        )
        if not text:
            continue
        source_file = _clean_text(
            item.get("source_file")
            or item.get("source")
            or item.get("title")
            or item.get("id")
        )
        chunks.append({"text": text, "source": source_file})

    return chunks


def _extract_retrieved_documentation(
    user: Any,
    puzzle: Any,
    messages: Any,
    limits: ContextBuilderLimits,
) -> str:
    candidate_objects: list[Any] = [messages, puzzle, user]
    if isinstance(messages, Sequence) and not isinstance(
        messages, (str, bytes, bytearray)
    ):
        candidate_objects.extend(messages)
    candidate_keys = (
        "retrieved_documentation",
        "retrievedDocumentation",
        "documentation_chunks",
        "documentationChunks",
        "doc_chunks",
        "docChunks",
        "retrieval_results",
        "retrievalResults",
        "docs",
    )

    gathered_chunks: list[dict[str, str]] = []
    for obj in candidate_objects:
        for source in _candidate_sources(
            obj,
            (
                "metadata",
                "context",
                "retrieval",
                "docs",
                "agent",
                "state",
            ),
        ):
            for key in candidate_keys:
                extracted = _safe_get_value(source, key)
                if extracted is None:
                    continue
                gathered_chunks.extend(_extract_doc_chunks_from_source(extracted))

    if not gathered_chunks:
        return _DEFAULT_EMPTY_DOCS

    rows: list[str] = []
    for idx, chunk in enumerate(gathered_chunks[: limits.max_doc_chunks], start=1):
        source_label = chunk["source"] or f"doc_{idx}"
        chunk_text = _truncate(chunk["text"], limits.max_doc_chunk_chars)
        rows.append(f"[{idx}] source={source_label}")
        rows.append(chunk_text)

    return (
        _enforce_section_limit("\n".join(rows), limits.max_docs_chars)
        or _DEFAULT_EMPTY_DOCS
    )


def _is_private_field_name(field_name: str) -> bool:
    normalized = field_name.strip().lower().replace("-", "_")
    if not normalized:
        return True
    return any(keyword in normalized for keyword in _SECRET_FIELD_KEYWORDS)


def _sanitize_for_debug(value: Any, *, max_depth: int = 3) -> Any:
    if max_depth <= 0:
        return None
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for key, candidate in value.items():
            key_text = _clean_text(key)
            if key_text.startswith("_"):
                continue
            if _is_private_field_name(key_text):
                continue
            clean_value = _sanitize_for_debug(candidate, max_depth=max_depth - 1)
            if clean_value is None:
                continue
            out[key_text] = clean_value
        return out or None
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        sanitized_items = [
            _sanitize_for_debug(item, max_depth=max_depth - 1) for item in value[:5]
        ]
        keep = [item for item in sanitized_items if item is not None]
        return keep or None
    return None


def _build_current_message_block(user_query: Any, limits: ContextBuilderLimits) -> str:
    message = _clean_text(user_query)
    if not message:
        message = _DEFAULT_EMPTY_MESSAGE
    return _enforce_section_limit(message, limits.max_user_message_chars)


def _limit_existing_section_body(section_text: str, *, max_chars: int) -> str:
    lines = _to_safe_lines(section_text)
    if not lines:
        return ""

    # If input already includes a "SECTION:" heading, strip the first line to avoid nesting.
    if lines[0].endswith(":"):
        lines = lines[1:]

    body = "\n".join(lines).strip()
    return _enforce_section_limit(body, max_chars)


def _compose_context_sections(
    *,
    system_prompt: str,
    engine_analysis: str,
    puzzle_context: str,
    docs_context: str,
    user_profile: str,
    conversation_context: str,
    current_message: str,
    limits: ContextBuilderLimits,
) -> str:
    puzzle_body = _limit_existing_section_body(
        puzzle_context,
        max_chars=max(300, limits.max_puzzle_chars - 300),
    )
    sections = [
        ("SYSTEM", _enforce_section_limit(system_prompt, limits.max_system_chars)),
        (
            "USER PROFILE",
            _limit_existing_section_body(
                user_profile,
                max_chars=limits.max_profile_chars,
            ),
        ),
        (
            "CURRENT PUZZLE",
            _limit_existing_section_body(
                "\n".join(
                    [
                        "CURRENT PUZZLE:",
                        f"ENGINE ANALYSIS:\n{engine_analysis}",
                        puzzle_body,
                    ]
                ),
                max_chars=limits.max_puzzle_chars,
            ),
        ),
        (
            "RELEVANT DOCUMENTATION",
            _enforce_section_limit(docs_context, limits.max_docs_chars),
        ),
        (
            "RECENT CONVERSATION",
            _limit_existing_section_body(
                conversation_context,
                max_chars=limits.max_conversation_chars,
            ),
        ),
        ("CURRENT USER MESSAGE", current_message),
    ]

    rendered_sections = [f"{name}:\n{body}" for name, body in sections]
    assembled = "\n\n".join(rendered_sections).strip()
    if len(assembled) <= limits.max_total_chars:
        return assembled

    # Deterministic total-budget fallback: compress lowest-priority sections first.
    # Priority (highest to lowest): system, engine, puzzle, docs, profile, conversation, user request.
    # User request remains as-is; we trim docs/profile/conversation, then puzzle, then system as last resort.
    mutable_sections = sections[:]
    trim_order = {
        "RECENT CONVERSATION": max(300, limits.max_conversation_chars // 2),
        "USER PROFILE": max(300, limits.max_profile_chars // 2),
        "RELEVANT DOCUMENTATION": max(500, limits.max_docs_chars // 2),
        "CURRENT PUZZLE": max(500, limits.max_puzzle_chars // 2),
        "SYSTEM": max(800, limits.max_system_chars // 2),
    }

    for idx, (name, body) in enumerate(mutable_sections):
        if (
            len("\n\n".join(f"{n}:\n{b}" for n, b in mutable_sections))
            <= limits.max_total_chars
        ):
            break
        if name not in trim_order:
            continue
        mutable_sections[idx] = (name, _truncate(body, trim_order[name]))

    rendered = [f"{name}:\n{body}" for name, body in mutable_sections]
    final_context = "\n\n".join(rendered).strip()
    return _truncate(final_context, limits.max_total_chars)


def _log_context_debug(
    *,
    context: str,
    system_prompt: str,
    engine_analysis: str,
    puzzle_context: str,
    docs_context: str,
    user_profile: str,
    conversation_context: str,
    current_message: str,
    user: Any,
    puzzle: Any,
) -> None:
    if not logger.isEnabledFor(logging.DEBUG):
        return

    section_sizes = {
        "system": len(system_prompt),
        "engine_analysis": len(engine_analysis),
        "puzzle": len(puzzle_context),
        "docs": len(docs_context),
        "profile": len(user_profile),
        "conversation": len(conversation_context),
        "user_message": len(current_message),
        "assembled": len(context),
    }

    safe_preview = _truncate(context, 1200)
    safe_user = _sanitize_for_debug(user)
    safe_puzzle = _sanitize_for_debug(puzzle)

    logger.debug(
        "agent_context_assembled sizes=%s safe_user=%s safe_puzzle=%s preview=%s",
        section_sizes,
        safe_user,
        safe_puzzle,
        safe_preview,
    )


def build_agent_context(
    user: Any,
    puzzle: Any,
    messages: Any,
    user_query: Any,
) -> str:
    """
    Assemble the final Amy context payload with strict section ordering.

    Priority ordering:
    1) System rules
    2) Engine analysis
    3) Puzzle state
    4) Retrieved documentation
    5) User profile
    6) Conversation history
    7) User request
    """
    limits = DEFAULT_CONTEXT_LIMITS

    system_prompt = get_system_prompt()
    engine_analysis = _extract_engine_analysis(puzzle, limits)
    puzzle_context = build_puzzle_context(puzzle)
    docs_context = _extract_retrieved_documentation(user, puzzle, messages, limits)
    user_profile = build_user_profile_context(user)
    conversation_context = build_recent_conversation_context(messages)
    current_message = _build_current_message_block(user_query, limits)

    context = _compose_context_sections(
        system_prompt=system_prompt,
        engine_analysis=engine_analysis,
        puzzle_context=puzzle_context,
        docs_context=docs_context,
        user_profile=user_profile,
        conversation_context=conversation_context,
        current_message=current_message,
        limits=limits,
    )

    _log_context_debug(
        context=context,
        system_prompt=system_prompt,
        engine_analysis=engine_analysis,
        puzzle_context=puzzle_context,
        docs_context=docs_context,
        user_profile=user_profile,
        conversation_context=conversation_context,
        current_message=current_message,
        user=user,
        puzzle=puzzle,
    )

    return context
