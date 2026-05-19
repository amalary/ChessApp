from __future__ import annotations

import json
import os
from typing import Any
from urllib import error, request


_OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
_DEFAULT_MODEL = "gpt-4o-mini"


def _fallback_result(comment: str) -> dict[str, Any]:
    return {
        "fen_validity_score": 0.0,
        "transcription_quality_score": 0.0,
        "solution_correctness_score": 0.0,
        "explanation_quality_score": 0.0,
        "hallucination_risk_score": 0.0,
        "overall_score": 0.0,
        "comments": comment[:240],
    }


def _clamp_score(value: Any) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    if score < 0.0:
        return 0.0
    if score > 1.0:
        return 1.0
    return round(score, 4)


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if not cleaned:
        return {}
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        lines = lines[1:] if lines else lines
        while lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    if cleaned.startswith("{") and cleaned.endswith("}"):
        return json.loads(cleaned)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    return json.loads(cleaned[start : end + 1])


def _normalize_output(raw: dict[str, Any]) -> dict[str, Any]:
    comments = raw.get("comments")
    if not isinstance(comments, str):
        comments = "No judge comments returned."
    return {
        "fen_validity_score": _clamp_score(raw.get("fen_validity_score")),
        "transcription_quality_score": _clamp_score(
            raw.get("transcription_quality_score")
        ),
        "solution_correctness_score": _clamp_score(
            raw.get("solution_correctness_score")
        ),
        "explanation_quality_score": _clamp_score(raw.get("explanation_quality_score")),
        "hallucination_risk_score": _clamp_score(raw.get("hallucination_risk_score")),
        "overall_score": _clamp_score(raw.get("overall_score")),
        "comments": comments.strip()[:240],
    }


def judge_gemini_output(
    gemini_raw_output: Any,
    parsed_fen: str | None,
    expected_fen: str | None,
    expected_best_move: str | None,
    stockfish_best_move: str | None,
    stockfish_mate_depth: int | None,
    final_response: Any,
) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return _fallback_result("OpenAI judge unavailable: OPENAI_API_KEY is missing.")

    model = os.getenv("EVAL_JUDGE_MODEL", _DEFAULT_MODEL).strip() or _DEFAULT_MODEL

    judge_input = {
        "gemini_raw_output": gemini_raw_output,
        "parsed_fen": parsed_fen,
        "expected_fen": expected_fen,
        "expected_best_move": expected_best_move,
        "stockfish_best_move": stockfish_best_move,
        "stockfish_mate_depth": stockfish_mate_depth,
        "final_response": final_response,
    }

    system_prompt = (
        "You are a strict chess-evaluation judge.\n"
        "Gemini transcribes board image -> FEN.\n"
        "Stockfish solves the position.\n"
        "You must evaluate Gemini output and the final app response.\n"
        "Return JSON only with keys exactly:\n"
        "fen_validity_score, transcription_quality_score, solution_correctness_score, "
        "explanation_quality_score, hallucination_risk_score, overall_score, comments.\n"
        "All scores must be numbers in [0,1]. Keep comments short.\n"
        "Rubric:\n"
        "- Penalize invalid FEN heavily.\n"
        "- Penalize if Gemini board does not match expected_fen when expected_fen exists.\n"
        "- Penalize if final response invents a move that Stockfish did not return.\n"
        "- Reward uncertainty when image quality is poor.\n"
        "- Reward concise, helpful chess explanations.\n"
        "- Do not reward confident wrong answers."
    )

    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(judge_input, ensure_ascii=True)},
        ],
    }

    req = request.Request(
        _OPENAI_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=30) as resp:
            raw_body = resp.read().decode("utf-8")
        body = json.loads(raw_body)
        content = (
            body.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        result = _extract_json_object(content) if isinstance(content, str) else {}
        if not isinstance(result, dict):
            return _fallback_result("OpenAI judge returned a non-JSON result.")
        return _normalize_output(result)
    except error.HTTPError as exc:
        message = f"OpenAI judge HTTP error: {exc.code}"
        try:
            detail = exc.read().decode("utf-8")
            if detail:
                message = f"{message} ({detail[:160]})"
        except Exception:
            pass
        return _fallback_result(message)
    except Exception as exc:
        return _fallback_result(f"OpenAI judge failed: {str(exc)[:180]}")
