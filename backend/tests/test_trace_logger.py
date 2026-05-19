from __future__ import annotations

import json

from app.evals import trace_logger


def test_log_solve_trace_redacts_secrets(tmp_path, monkeypatch):
    report_path = tmp_path / "reports" / "solve_traces.jsonl"
    monkeypatch.setattr(trace_logger, "_REPORT_PATH", report_path)

    raw_api_key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"
    raw_jwt = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
        "eyJzdWIiOiJ1c2VyIiwiYWRtaW4iOmZhbHNlfQ."
        "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0"
    )

    trace_logger.log_solve_trace(
        image_filename="board.png",
        gemini_raw_output=f"API={raw_api_key}",
        parsed_fen="8/8/8/8/8/8/8/8 w - - 0 1",
        fen_valid=True,
        stockfish_best_move="e2e4",
        stockfish_mate_depth=2,
        final_response={"authorization": f"Bearer {raw_jwt}"},
        latency_ms=321,
        error_message=f"jwt={raw_jwt}",
    )

    lines = report_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    payload = json.loads(lines[0])

    assert payload["trace_id"]
    assert payload["image_filename"] == "board.png"
    assert payload["fen_valid"] is True
    assert payload["latency_ms"] == 321
    assert payload["gemini_raw_output"] == "API=[REDACTED_API_KEY]"
    assert payload["final_response"]["authorization"] == "[REDACTED]"
    assert payload["error_message"] == "jwt=[REDACTED_JWT]"

    serialized = lines[0]
    assert raw_api_key not in serialized
    assert raw_jwt not in serialized

