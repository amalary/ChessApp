from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

from app.evals import report


_THRESHOLD = 0.70
_MISSING_KEYS_MESSAGE = "Missing GOOGLE_API_KEY or OPENAI_API_KEY. Skipping AI eval."


def _load_env() -> None:
    backend_root = Path(__file__).resolve().parents[2]
    load_dotenv(backend_root / ".env", override=False)
    load_dotenv(backend_root.parent / ".env", override=False)


def _resolve_paths(
    summary_path: Path,
    results_path: Path,
) -> tuple[Path, Path]:
    default_reports_dir = Path(__file__).resolve().parent / "reports"
    resolved_summary = report._resolve_input_path(
        summary_path,
        fallback_locations=(
            default_reports_dir / "eval_summary.json",
            Path(__file__).resolve().parent / "eval_summary.json",
            Path.cwd() / "eval_summary.json",
        ),
    )
    resolved_results = report._resolve_input_path(
        results_path,
        fallback_locations=(
            default_reports_dir / "eval_results.jsonl",
            Path(__file__).resolve().parent / "eval_results.jsonl",
            Path.cwd() / "eval_results.jsonl",
        ),
    )
    return resolved_summary, resolved_results


def _compute_metrics(summary_path: Path, results_path: Path) -> dict[str, object]:
    summary = report._read_json(summary_path)
    records = report._read_jsonl(results_path)

    fen_metric = report._metric_from_checks(
        records=records,
        aliases=("expected_fen_match", "fen_validity", "fen_match"),
        label="FEN accuracy",
    )
    best_move_metric = report._metric_from_checks(
        records=records,
        aliases=("expected_best_move_match", "best_move_match"),
        label="best move accuracy",
    )

    judge_values = [
        score
        for score in (report._extract_judge_score(record) for record in records)
        if score is not None
    ]
    avg_judge = sum(judge_values) / len(judge_values) if judge_values else None
    if avg_judge is None:
        avg_judge = report._first_number(
            summary,
            (
                "average_openai_judge_score",
                "avg_openai_judge_score",
                "openai_judge_average_score",
                "average_judge_score",
            ),
        )

    summary_total = report._first_int(
        summary,
        ("total_examples", "total", "num_examples", "example_count"),
    )
    has_data = bool(records) or (summary_total is not None and summary_total > 0)

    return {
        "has_data": has_data,
        "fen_metric": fen_metric,
        "best_move_metric": best_move_metric,
        "avg_judge": avg_judge,
        "summary_path": summary_path,
        "results_path": results_path,
    }


def _format_percent(value: float | None) -> str:
    if value is None:
        return "N/A"
    return f"{value * 100:.2f}%"


def run_quick_eval(summary_path: Path, results_path: Path) -> int:
    _load_env()
    summary_path, results_path = _resolve_paths(summary_path, results_path)
    metrics = _compute_metrics(summary_path, results_path)

    google_api_key = (os.getenv("GOOGLE_API_KEY") or "").strip()
    openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    judge_enabled = bool(google_api_key and openai_api_key)
    if not judge_enabled:
        print(_MISSING_KEYS_MESSAGE)

    if not bool(metrics["has_data"]):
        print(
            "No eval data found. Skipping quick eval. "
            f"(summary: {summary_path}, results: {results_path})"
        )
        return 0

    fen_metric = metrics["fen_metric"]
    best_move_metric = metrics["best_move_metric"]
    avg_judge = metrics["avg_judge"]

    assert isinstance(fen_metric, report.AccuracyMetric)
    assert isinstance(best_move_metric, report.AccuracyMetric)
    assert avg_judge is None or isinstance(avg_judge, float)

    failures: list[str] = []

    fen_percent = fen_metric.percent
    best_move_percent = best_move_metric.percent
    print(f"FEN accuracy: {_format_percent(fen_percent)}")
    print(f"best move accuracy: {_format_percent(best_move_percent)}")

    if fen_percent is not None and fen_percent < _THRESHOLD:
        failures.append(
            f"FEN accuracy below {_THRESHOLD:.0%}: {_format_percent(fen_percent)}"
        )
    if best_move_percent is not None and best_move_percent < _THRESHOLD:
        failures.append(
            f"best move accuracy below {_THRESHOLD:.0%}: {_format_percent(best_move_percent)}"
        )

    if judge_enabled:
        if avg_judge is not None:
            print(f"average OpenAI judge score: {avg_judge:.4f}")
        else:
            print("average OpenAI judge score: N/A")
        if avg_judge is not None and avg_judge < _THRESHOLD:
            failures.append(
                f"average OpenAI judge score below {_THRESHOLD:.2f}: {avg_judge:.4f}"
            )
    else:
        print("average OpenAI judge score: skipped")

    if failures:
        print("Quick eval failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Quick eval passed.")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run lightweight CI-safe eval checks.")
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Run threshold-based quick checks for CI.",
    )
    parser.add_argument(
        "--summary-path",
        type=Path,
        default=Path("eval_summary.json"),
        help="Path to eval_summary.json",
    )
    parser.add_argument(
        "--results-path",
        type=Path,
        default=Path("eval_results.jsonl"),
        help="Path to eval_results.jsonl",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.quick:
        raise SystemExit(run_quick_eval(args.summary_path, args.results_path))
    raise SystemExit("Only --quick is currently supported.")


if __name__ == "__main__":
    main()
