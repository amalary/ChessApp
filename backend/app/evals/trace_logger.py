from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

logger = logging.getLogger(__name__)

TRACE_REPORT_PATH = (
    Path(__file__).resolve().parent / "reports" / "solve_traces.jsonl"
)

_JWT_RE = re.compile(
    r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"
)
_GOOGLE_API_KEY_RE = re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b")
_KEY_VALUE_SECRET_RE = re.compile(
    r"(?i)\b(google_api_key|gemini_api_key|api_key|apikey|authorization|auth0|jwt)"
    r"\b\s*[:=]\s*([\"']?)[^\"'\s,}]+([\"']?)"
)

_SECRET_KEY_NAMES = {
    "authorization",
    "auth0_jwt",
    "jwt",
    "token",
    "access_token",
    "id_token",
    "refresh_token",
    "api_key",
    "google_api_key",
    "gemini_api_key",
}


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize_string(value: str) -> str:
    redacted = _JWT_RE.sub("[REDACTED_JWT]", value)
    redacted = _GOOGLE_API_KEY_RE.sub("[REDACTED_API_KEY]", redacted)
    redacted = _KEY_VALUE_SECRET_RE.sub(r"\1=[REDACTED]", redacted)
    return redacted


def _sanitize(value: Any, key_name: str | None = None) -> Any:
    key = (key_name or "").strip().lower()
    if key in _SECRET_KEY_NAMES:
        return "[REDACTED]"
    if isinstance(value, str):
        return _sanitize_string(value)
    if isinstance(value, Mapping):
        return {str(k): _sanitize(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize(item) for item in value]
    return value


def _build_trace_record(trace: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "trace_id": trace.get("trace_id"),
        "timestamp": trace.get("timestamp") or utc_timestamp(),
        "image_filename": trace.get("image_filename"),
        "gemini_raw_output": _sanitize(trace.get("gemini_raw_output")),
        "parsed_fen": trace.get("parsed_fen"),
        "fen_valid": trace.get("fen_valid"),
        "stockfish_best_move": trace.get("stockfish_best_move"),
        "stockfish_mate_depth": trace.get("stockfish_mate_depth"),
        "final_response": _sanitize(trace.get("final_response")),
        "latency_ms": trace.get("latency_ms"),
        "error_message": _sanitize(trace.get("error_message")),
    }


def log_solve_trace(trace: Mapping[str, Any], path: Path | None = None) -> None:
    target = path or TRACE_REPORT_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    record = _build_trace_record(trace)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=True) + "\n")


def log_solve_trace_safe(trace: Mapping[str, Any], path: Path | None = None) -> None:
    try:
        log_solve_trace(trace=trace, path=path)
    except Exception:
        logger.exception("Failed to write solve trace log.")
