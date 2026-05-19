from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)

_REPORT_PATH = Path(__file__).resolve().parent / "reports" / "solve_traces.jsonl"
_WRITE_LOCK = Lock()

_OPENAI_KEY_RE = re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b")
_GOOGLE_KEY_RE = re.compile(r"\bAIza[A-Za-z0-9_\-]{20,}\b")
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b")
_BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b", re.IGNORECASE)

_SENSITIVE_FIELD_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "auth",
    "token",
    "access_token",
    "id_token",
    "refresh_token",
    "jwt",
    "auth0_jwt",
    "password",
    "secret",
}


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _redact_string(value: str) -> str:
    cleaned = _OPENAI_KEY_RE.sub("[REDACTED_API_KEY]", value)
    cleaned = _GOOGLE_KEY_RE.sub("[REDACTED_API_KEY]", cleaned)
    cleaned = _JWT_RE.sub("[REDACTED_JWT]", cleaned)
    cleaned = _BEARER_RE.sub("Bearer [REDACTED]", cleaned)
    return cleaned


def _is_sensitive_key(key: str) -> bool:
    lowered = key.strip().lower()
    if lowered in _SENSITIVE_FIELD_KEYS:
        return True
    return any(fragment in lowered for fragment in ("token", "secret", "password"))


def _sanitize(value: Any, *, key_hint: str | None = None) -> Any:
    if key_hint and _is_sensitive_key(key_hint):
        return "[REDACTED]"
    if isinstance(value, str):
        return _redact_string(value)
    if isinstance(value, dict):
        return {
            str(k): _sanitize(v, key_hint=str(k))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [_sanitize(item) for item in value]
    return value


def build_solve_trace(
    *,
    trace_id: str | None = None,
    timestamp: str | None = None,
    image_filename: str | None = None,
    gemini_raw_output: Any = None,
    parsed_fen: str | None = None,
    fen_valid: bool | None = None,
    stockfish_best_move: str | None = None,
    stockfish_mate_depth: int | None = None,
    final_response: Any = None,
    latency_ms: int | float | None = None,
    error_message: str | None = None,
) -> dict[str, Any]:
    safe_trace_id = trace_id or str(uuid.uuid4())
    safe_timestamp = timestamp or _utc_iso_now()
    safe_latency = None
    if isinstance(latency_ms, (int, float)):
        safe_latency = max(0, int(round(float(latency_ms))))

    return {
        "trace_id": safe_trace_id,
        "timestamp": safe_timestamp,
        "image_filename": _sanitize(image_filename),
        "gemini_raw_output": _sanitize(gemini_raw_output),
        "parsed_fen": _sanitize(parsed_fen),
        "fen_valid": fen_valid,
        "stockfish_best_move": _sanitize(stockfish_best_move),
        "stockfish_mate_depth": stockfish_mate_depth,
        "final_response": _sanitize(final_response),
        "latency_ms": safe_latency,
        "error_message": _sanitize(error_message),
    }


def log_solve_trace(**trace_fields: Any) -> None:
    try:
        trace = build_solve_trace(**trace_fields)
        payload = json.dumps(trace, ensure_ascii=True)
        _REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _WRITE_LOCK:
            with _REPORT_PATH.open("a", encoding="utf-8") as handle:
                handle.write(payload + "\n")
    except Exception:
        logger.exception("Failed to persist solve trace.")

