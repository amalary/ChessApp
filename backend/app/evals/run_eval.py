from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from urllib import error, request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from time import perf_counter
from typing import Any, TypedDict

import chess

THIS_FILE = Path(__file__).resolve()
EVALS_DIR = THIS_FILE.parent
BACKEND_DIR = THIS_FILE.parents[2]
PROJECT_ROOT = BACKEND_DIR.parent

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.gemini_fen import fen_from_image_bytes  # noqa: E402
from app.services.mate_solver import (  # noqa: E402
    EngineCrashedError,
    MateLine,
    find_mate_in_1_to_3,
)

DEFAULT_CASES_PATH = EVALS_DIR / "data" / "chess_eval_cases.jsonl"
DEFAULT_RESULTS_PATH = EVALS_DIR / "reports" / "eval_results.jsonl"
DEFAULT_SUMMARY_PATH = EVALS_DIR / "reports" / "eval_summary.json"

INVALID_GEMINI_FEN_DETAIL = "Invalid FEN returned from Gemini"
INVALID_POSITION_DETAIL = "Invalid chess position detected"
STOCKFISH_NOT_FOUND_DETAIL = (
    "Stockfish not found. Install Stockfish locally and set STOCKFISH_PATH "
    "to the executable path."
)
ENV_OVERRIDE_KEYS = {
    "DATABASE_URL",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
    "DB_HOST",
    "DB_PORT",
}

_OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
_DEFAULT_JUDGE_MODEL = "gpt-4o-mini"


class EvalResult(TypedDict):
    name: str
    score: int
    passed: bool
    comment: str


def _result(name: str, passed: bool, comment: str) -> EvalResult:
    return {
        "name": name,
        "score": 1 if passed else 0,
        "passed": passed,
        "comment": comment,
    }


def _normalize_fen(fen: str | None) -> str | None:
    if not isinstance(fen, str) or not fen.strip():
        return None
    try:
        return chess.Board(fen.strip()).fen()
    except ValueError:
        return None


def _normalize_move(move: str | None) -> str | None:
    if not isinstance(move, str):
        return None
    cleaned = move.strip()
    if not cleaned:
        return None
    try:
        return chess.Move.from_uci(cleaned.lower()).uci()
    except ValueError:
        return cleaned.lower()


def evaluate_valid_fen(fen: str | None) -> EvalResult:
    normalized = _normalize_fen(fen)
    if normalized is None:
        return _result(
            name="fen_validity",
            passed=False,
            comment="FEN is invalid or empty.",
        )
    return _result(
        name="fen_validity",
        passed=True,
        comment="FEN parsed successfully.",
    )


def evaluate_expected_fen_match(
    actual_fen: str | None, expected_fen: str | None
) -> EvalResult:
    actual_normalized = _normalize_fen(actual_fen)
    expected_normalized = _normalize_fen(expected_fen)
    if actual_normalized is None or expected_normalized is None:
        return _result(
            name="expected_fen_match",
            passed=False,
            comment="Could not compare FEN values.",
        )
    passed = actual_normalized == expected_normalized
    return _result(
        name="expected_fen_match",
        passed=passed,
        comment=(
            "Actual FEN matches expected FEN."
            if passed
            else "Actual FEN does not match expected FEN."
        ),
    )


def evaluate_expected_best_move_match(
    actual_best_move: str | None, expected_best_move: str | None
) -> EvalResult:
    actual_normalized = _normalize_move(actual_best_move)
    expected_normalized = _normalize_move(expected_best_move)
    if actual_normalized is None or expected_normalized is None:
        return _result(
            name="expected_best_move_match",
            passed=False,
            comment="Could not compare best-move values.",
        )
    passed = actual_normalized == expected_normalized
    return _result(
        name="expected_best_move_match",
        passed=passed,
        comment=(
            "Best move matches expected move."
            if passed
            else "Best move does not match expected move."
        ),
    )


def evaluate_expected_mate_depth_match(
    actual_mate_depth: int | None, expected_mate_depth: int | None
) -> EvalResult:
    passed = actual_mate_depth == expected_mate_depth
    return _result(
        name="expected_mate_depth_match",
        passed=passed,
        comment=(
            "Mate depth matches expected value."
            if passed
            else "Mate depth does not match expected value."
        ),
    )


def evaluate_stockfish_success(stockfish_succeeded: bool) -> EvalResult:
    return _result(
        name="stockfish_success",
        passed=bool(stockfish_succeeded),
        comment=(
            "Stockfish solved successfully."
            if stockfish_succeeded
            else "Stockfish failed to solve."
        ),
    )


def evaluate_no_hallucinated_move_if_stockfish_failed(
    stockfish_succeeded: bool,
    returned_move: str | None,
) -> EvalResult:
    if stockfish_succeeded:
        return _result(
            name="no_hallucinated_move_if_stockfish_failed",
            passed=True,
            comment="Stockfish succeeded; hallucination check skipped.",
        )
    has_move = _normalize_move(returned_move) is not None
    return _result(
        name="no_hallucinated_move_if_stockfish_failed",
        passed=not has_move,
        comment=(
            "No move returned after Stockfish failure."
            if not has_move
            else "Move returned even though Stockfish failed."
        ),
    )


def _judge_fallback(comment: str) -> dict[str, Any]:
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


def _normalize_judge_output(raw: dict[str, Any]) -> dict[str, Any]:
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
        return _judge_fallback("OpenAI judge unavailable: OPENAI_API_KEY is missing.")

    model = (
        os.getenv("EVAL_JUDGE_MODEL", _DEFAULT_JUDGE_MODEL).strip()
        or _DEFAULT_JUDGE_MODEL
    )
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
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        result = _extract_json_object(content) if isinstance(content, str) else {}
        if not isinstance(result, dict):
            return _judge_fallback("OpenAI judge returned a non-JSON result.")
        return _normalize_judge_output(result)
    except error.HTTPError as exc:
        message = f"OpenAI judge HTTP error: {exc.code}"
        try:
            detail = exc.read().decode("utf-8")
            if detail:
                message = f"{message} ({detail[:160]})"
        except Exception:
            pass
        return _judge_fallback(message)
    except Exception as exc:
        return _judge_fallback(f"OpenAI judge failed: {str(exc)[:180]}")


@dataclass
class MetricCounter:
    hit: int = 0
    total: int = 0

    def add(self, passed: bool) -> None:
        self.total += 1
        if passed:
            self.hit += 1

    def ratio(self) -> float | None:
        if self.total == 0:
            return None
        return self.hit / self.total


def _load_env_file(
    path: Path,
    *,
    override_existing: bool = False,
    override_keys: set[str] | None = None,
    skip_keys: set[str] | None = None,
) -> None:
    if not path.exists() or not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if skip_keys and key in skip_keys:
            continue
        should_override = bool(override_keys and key in override_keys)
        if key and (key not in os.environ or override_existing or should_override):
            os.environ[key] = value


def _bootstrap_env() -> None:
    backend_env = BACKEND_DIR / ".env"
    _load_env_file(
        backend_env,
        override_existing=True,
        override_keys=ENV_OVERRIDE_KEYS,
    )

    candidates = [Path.cwd() / ".env", PROJECT_ROOT / ".env"]
    for parent in THIS_FILE.parents:
        candidates.append(parent / "ChessApp" / ".env")

    backend_env_resolved = backend_env.resolve()
    for env_path in candidates:
        if env_path.exists() and env_path.resolve() == backend_env_resolved:
            continue
        _load_env_file(env_path, skip_keys=ENV_OVERRIDE_KEYS)

    if "GOOGLE_API_KEY" not in os.environ and "GEMINI_API_KEY" in os.environ:
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _resolve_stockfish_path_or_raise() -> str:
    stockfish_path = (
        os.environ.get("STOCKFISH_PATH")
        or shutil.which("stockfish")
        or "/usr/games/stockfish"
    )
    if Path(stockfish_path).exists() or shutil.which("stockfish") is not None:
        return stockfish_path
    raise RuntimeError(STOCKFISH_NOT_FOUND_DETAIL)


def _validate_fen_or_raise(fen: str) -> None:
    try:
        board = chess.Board(fen)
    except Exception as exc:
        raise ValueError(INVALID_GEMINI_FEN_DETAIL) from exc
    if not board.is_valid():
        raise ValueError(INVALID_POSITION_DETAIL)


def _get_first(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    return None


def _normalize_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    cleaned = value.strip()
    return cleaned or None


def _normalize_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, raw in enumerate(handle, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Invalid JSONL at line {line_no} in {path}: {exc}"
                ) from exc
            if not isinstance(obj, dict):
                raise ValueError(
                    f"Expected JSON object at line {line_no} in {path}, got {type(obj)}"
                )
            rows.append(obj)
    return rows


def _resolve_image_path(raw_path: str, *, cases_path: Path) -> Path:
    candidate = Path(raw_path)
    if candidate.is_absolute() and candidate.exists():
        return candidate

    options = [
        cases_path.parent / candidate,
        BACKEND_DIR / candidate,
        PROJECT_ROOT / candidate,
    ]
    for option in options:
        if option.exists():
            return option

    raise FileNotFoundError(f"Image file not found for eval case: {raw_path}")


def _extract_best_move(result: MateLine | None) -> str | None:
    if result is None or not result.moves_uci:
        return None
    first = result.moves_uci[0]
    return first if isinstance(first, str) and first else None


def _skipped_result(name: str, comment: str) -> EvalResult:
    return {"name": name, "score": 1, "passed": True, "comment": comment}


def _run_case(
    *,
    raw_case: dict[str, Any],
    case_index: int,
    cases_path: Path,
    stockfish_path: str,
) -> dict[str, Any]:
    case_id = (
        _normalize_optional_str(
            _get_first(raw_case, "id", "case_id", "name", "caseName")
        )
        or f"case_{case_index + 1:03d}"
    )
    image_field = _normalize_optional_str(
        _get_first(
            raw_case,
            "image_path",
            "image",
            "image_file",
            "image_filename",
            "file_path",
            "path",
        )
    )
    if image_field is None:
        raise ValueError(f"Case {case_id} missing image_path/image field.")

    expected_fen = _normalize_optional_str(
        _get_first(raw_case, "expected_fen", "expectedFen")
    )
    expected_best_move = _normalize_optional_str(
        _get_first(
            raw_case,
            "expected_best_move",
            "expectedBestMove",
            "expected_best_move_uci",
            "expectedMove",
        )
    )
    expected_mate_depth = _normalize_optional_int(
        _get_first(
            raw_case,
            "expected_mate_depth",
            "expectedMateDepth",
            "expected_mate_in",
            "expectedMateIn",
            "mate_in",
        )
    )
    expected_side_to_move = _normalize_optional_str(
        _get_first(
            raw_case, "expected_side_to_move", "expectedSideToMove", "side_to_move"
        )
    )

    image_path = _resolve_image_path(image_field, cases_path=cases_path)
    image_bytes = image_path.read_bytes()
    started_at = perf_counter()

    error_message: str | None = None
    gemini_raw_output: Any = None
    parsed_fen: str | None = None
    fen_valid = False
    solver_result: MateLine | None = None
    final_response: dict[str, Any]

    try:
        gemini_result = fen_from_image_bytes(
            image_bytes,
            image_path.name,
            expected_side_to_move=expected_side_to_move,
            attempts=max(1, _env_int("GEMINI_TRANSCRIBE_ATTEMPTS", 5)),
            include_raw_output=True,
        )
        gemini_raw_output = gemini_result.get("raw_output")
        parsed_fen = _normalize_optional_str(gemini_result.get("fen"))
        if parsed_fen is None:
            raise ValueError(INVALID_GEMINI_FEN_DETAIL)

        _validate_fen_or_raise(parsed_fen)
        fen_valid = True

        solver_result = find_mate_in_1_to_3(
            fen=parsed_fen,
            stockfish_path=stockfish_path,
            think_time_s=2.0,
            max_mate=3,
        )
        final_response = {
            "fen": parsed_fen,
            "vision_confidence": gemini_result.get("confidence"),
            "vision_side_to_move": gemini_result.get("side_to_move"),
            "vision_attempts_used": gemini_result.get("attempts_used"),
            "mate_found": solver_result is not None,
            "mate_in": solver_result.mate_in if solver_result else None,
            "moves_san": solver_result.moves_san if solver_result else [],
            "moves_uci": solver_result.moves_uci if solver_result else [],
        }
    except (ValueError, EngineCrashedError, FileNotFoundError, RuntimeError) as exc:
        error_message = str(exc)
        final_response = {"error": error_message}
    except Exception as exc:  # Defensive catch to keep batch running.
        error_message = str(exc)
        final_response = {"error": error_message}

    stockfish_best_move = _extract_best_move(solver_result)
    stockfish_mate_depth = solver_result.mate_in if solver_result else None
    stockfish_succeeded = solver_result is not None

    deterministic: list[EvalResult] = [
        evaluate_valid_fen(parsed_fen),
        (
            evaluate_expected_fen_match(parsed_fen, expected_fen)
            if expected_fen is not None
            else _skipped_result("expected_fen_match", "Skipped: expected_fen missing.")
        ),
        (
            evaluate_expected_best_move_match(stockfish_best_move, expected_best_move)
            if expected_best_move is not None
            else _skipped_result(
                "expected_best_move_match", "Skipped: expected_best_move missing."
            )
        ),
        (
            evaluate_expected_mate_depth_match(
                stockfish_mate_depth, expected_mate_depth
            )
            if expected_mate_depth is not None
            else _skipped_result(
                "expected_mate_depth_match", "Skipped: expected_mate_depth missing."
            )
        ),
        evaluate_stockfish_success(stockfish_succeeded),
        evaluate_no_hallucinated_move_if_stockfish_failed(
            stockfish_succeeded=stockfish_succeeded,
            returned_move=stockfish_best_move,
        ),
    ]

    openai_judge = judge_gemini_output(
        gemini_raw_output=gemini_raw_output,
        parsed_fen=parsed_fen,
        expected_fen=expected_fen,
        expected_best_move=expected_best_move,
        stockfish_best_move=stockfish_best_move,
        stockfish_mate_depth=stockfish_mate_depth,
        final_response=final_response,
    )

    latency_ms = max(0, int(round((perf_counter() - started_at) * 1000)))
    return {
        "case_id": case_id,
        "index": case_index,
        "image_path": str(image_path),
        "expected_fen": expected_fen,
        "expected_best_move": expected_best_move,
        "expected_mate_depth": expected_mate_depth,
        "expected_side_to_move": expected_side_to_move,
        "gemini_raw_output": gemini_raw_output,
        "parsed_fen": parsed_fen,
        "fen_valid": fen_valid,
        "stockfish_best_move": stockfish_best_move,
        "stockfish_mate_depth": stockfish_mate_depth,
        "stockfish_succeeded": stockfish_succeeded,
        "final_response": final_response,
        "deterministic_evaluations": deterministic,
        "openai_judge": openai_judge,
        "error_message": error_message,
        "latency_ms": latency_ms,
    }


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")


def _print_summary(summary: dict[str, Any]) -> None:
    def pct(value: float | None) -> str:
        if value is None:
            return "N/A"
        return f"{(value * 100):.2f}%"

    print("Eval Summary")
    print(f"- total cases: {summary['total_cases']}")
    print(f"- FEN accuracy: {pct(summary['fen_accuracy'])}")
    print(f"- best move accuracy: {pct(summary['best_move_accuracy'])}")
    print(f"- mate depth accuracy: {pct(summary['mate_depth_accuracy'])}")
    print(f"- average OpenAI judge score: {summary['average_openai_judge_score']:.4f}")
    failed = summary.get("failed_cases", [])
    if failed:
        print(f"- failed cases ({len(failed)}): {', '.join(failed)}")
    else:
        print("- failed cases: none")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run chess solve evals across Gemini, Stockfish, deterministic checks, and OpenAI judge."
    )
    parser.add_argument(
        "--quick", action="store_true", help="Run only the first 3 cases."
    )
    parser.add_argument(
        "--cases",
        default=str(DEFAULT_CASES_PATH),
        help="Path to chess_eval_cases.jsonl",
    )
    parser.add_argument(
        "--results",
        default=str(DEFAULT_RESULTS_PATH),
        help="Path to write eval_results.jsonl",
    )
    parser.add_argument(
        "--summary",
        default=str(DEFAULT_SUMMARY_PATH),
        help="Path to write eval_summary.json",
    )
    args = parser.parse_args()

    _bootstrap_env()

    cases_path = Path(args.cases).resolve()
    results_path = Path(args.results).resolve()
    summary_path = Path(args.summary).resolve()

    if not cases_path.exists():
        raise FileNotFoundError(
            f"Cases file not found: {cases_path}. Expected backend/app/evals/data/chess_eval_cases.jsonl."
        )

    all_cases = _read_jsonl(cases_path)
    if args.quick:
        all_cases = all_cases[:3]

    stockfish_path = _resolve_stockfish_path_or_raise()

    results: list[dict[str, Any]] = []
    fen_metric = MetricCounter()
    move_metric = MetricCounter()
    mate_metric = MetricCounter()
    judge_scores: list[float] = []
    failed_cases: list[str] = []

    for idx, raw_case in enumerate(all_cases):
        row = _run_case(
            raw_case=raw_case,
            case_index=idx,
            cases_path=cases_path,
            stockfish_path=stockfish_path,
        )
        results.append(row)

        expected_fen = _normalize_optional_str(row.get("expected_fen"))
        expected_best = _normalize_optional_str(row.get("expected_best_move"))
        expected_mate = _normalize_optional_int(row.get("expected_mate_depth"))

        det = {
            item["name"]: bool(item["passed"])
            for item in row.get("deterministic_evaluations", [])
            if isinstance(item, dict) and "name" in item and "passed" in item
        }
        if expected_fen is not None:
            fen_metric.add(det.get("expected_fen_match", False))
        if expected_best is not None:
            move_metric.add(det.get("expected_best_move_match", False))
        if expected_mate is not None:
            mate_metric.add(det.get("expected_mate_depth_match", False))

        judge = row.get("openai_judge", {})
        if isinstance(judge, dict):
            try:
                judge_scores.append(float(judge.get("overall_score", 0.0)))
            except (TypeError, ValueError):
                pass

        case_id = str(row.get("case_id"))
        has_error = bool(row.get("error_message"))
        mismatch = (
            (expected_fen is not None and not det.get("expected_fen_match", False))
            or (
                expected_best is not None
                and not det.get("expected_best_move_match", False)
            )
            or (
                expected_mate is not None
                and not det.get("expected_mate_depth_match", False)
            )
        )
        if has_error or mismatch:
            failed_cases.append(case_id)

    _write_jsonl(results_path, results)

    summary: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "quick_mode": bool(args.quick),
        "cases_file": str(cases_path),
        "results_file": str(results_path),
        "total_cases": len(results),
        "fen_accuracy": fen_metric.ratio(),
        "fen_accuracy_hits": fen_metric.hit,
        "fen_accuracy_total": fen_metric.total,
        "best_move_accuracy": move_metric.ratio(),
        "best_move_accuracy_hits": move_metric.hit,
        "best_move_accuracy_total": move_metric.total,
        "mate_depth_accuracy": mate_metric.ratio(),
        "mate_depth_accuracy_hits": mate_metric.hit,
        "mate_depth_accuracy_total": mate_metric.total,
        "average_openai_judge_score": (
            round(mean(judge_scores), 4) if judge_scores else 0.0
        ),
        "failed_cases": failed_cases,
    }
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=True), encoding="utf-8"
    )

    _print_summary(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
