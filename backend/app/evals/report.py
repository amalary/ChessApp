from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class AccuracyMetric:
    label: str
    passed: int
    total: int

    def render(self) -> str:
        if self.total <= 0:
            return "N/A (no data)"
        percent = (self.passed / self.total) * 100
        return f"{percent:.2f}% ({self.passed}/{self.total})"


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    for line in lines:
        cleaned = line.strip()
        if not cleaned:
            continue
        try:
            value = json.loads(cleaned)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            rows.append(value)
    return rows


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "pass", "passed", "ok", "success"}:
            return True
        if lowered in {"false", "fail", "failed", "error"}:
            return False
    return None


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _extract_checks(record: dict[str, Any]) -> dict[str, tuple[bool, str | None]]:
    checks: dict[str, tuple[bool, str | None]] = {}

    def add(name: str, passed: Any, comment: Any = None) -> None:
        key = name.strip().lower()
        if not key:
            return
        passed_bool = _as_bool(passed)
        if passed_bool is None:
            return
        text = comment.strip() if isinstance(comment, str) and comment.strip() else None
        checks[key] = (passed_bool, text)

    for container_key in (
        "deterministic_evaluations",
        "deterministic_results",
        "deterministic_evals",
        "eval_results",
        "evaluations",
        "checks",
    ):
        container = record.get(container_key)
        if isinstance(container, list):
            for item in container:
                if isinstance(item, dict):
                    add(
                        str(item.get("name", "")),
                        item.get("passed"),
                        item.get("comment"),
                    )
        elif isinstance(container, dict):
            for name, result in container.items():
                if isinstance(result, dict):
                    add(str(name), result.get("passed"), result.get("comment"))
                else:
                    add(str(name), result)

    for key in (
        "fen_validity",
        "expected_fen_match",
        "expected_best_move_match",
        "expected_mate_depth_match",
    ):
        if key in record:
            add(key, record.get(key))

    return checks


def _first_number(source: dict[str, Any], keys: tuple[str, ...]) -> float | None:
    for key in keys:
        if key in source:
            value = _as_float(source.get(key))
            if value is not None:
                return value
    return None


def _first_int(source: dict[str, Any], keys: tuple[str, ...]) -> int | None:
    value = _first_number(source, keys)
    if value is None:
        return None
    return int(value)


def _extract_passed(
    record: dict[str, Any], checks: dict[str, tuple[bool, str | None]]
) -> bool | None:
    for key in ("passed", "success", "all_passed", "all_checks_passed"):
        if key in record:
            parsed = _as_bool(record.get(key))
            if parsed is not None:
                return parsed

    if checks:
        return all(passed for passed, _ in checks.values())

    if (
        record.get("error")
        or record.get("error_message")
        or record.get("failure_reason")
    ):
        return False
    return None


def _extract_judge_score(record: dict[str, Any]) -> float | None:
    for nested_key in ("openai_judge", "judge", "judge_result"):
        nested = record.get(nested_key)
        if isinstance(nested, dict):
            score = _first_number(
                nested,
                ("overall_score", "judge_score", "score", "openai_judge_score"),
            )
            if score is not None:
                return score
    return _first_number(
        record,
        ("overall_score", "judge_score", "openai_judge_score", "openai_overall_score"),
    )


def _metric_from_checks(
    records: list[dict[str, Any]], aliases: tuple[str, ...], label: str
) -> AccuracyMetric:
    alias_set = {alias.lower() for alias in aliases}
    passed = 0
    total = 0
    for record in records:
        checks = _extract_checks(record)
        hit: bool | None = None
        for name, (ok, _) in checks.items():
            if name in alias_set:
                hit = ok
                break
        if hit is None:
            continue
        total += 1
        if hit:
            passed += 1
    return AccuracyMetric(label=label, passed=passed, total=total)


def _collect_failure_reasons(
    records: list[dict[str, Any]], passed_values: list[bool | None]
) -> Counter[str]:
    counts: Counter[str] = Counter()

    for record, passed in zip(records, passed_values):
        if passed is True:
            continue

        reasons: list[str] = []
        for key in ("failure_reason", "reason", "error_message", "error"):
            value = record.get(key)
            if isinstance(value, str) and value.strip():
                reasons.append(value.strip())

        for _, (ok, comment) in _extract_checks(record).items():
            if not ok and comment:
                reasons.append(comment.strip())

        if not reasons:
            reasons.append("unknown_failure")

        for reason in reasons:
            cleaned = " ".join(reason.split())
            if cleaned:
                counts[cleaned] += 1

    return counts


def _resolve_input_path(path: Path, fallback_locations: tuple[Path, ...]) -> Path:
    if path.exists():
        return path
    for candidate in fallback_locations:
        if candidate.exists():
            return candidate
    return path


def _render_console_report(
    *,
    total_examples: int,
    passed_examples: int,
    failed_examples: int,
    avg_judge_score: float | None,
    fen_metric: AccuracyMetric,
    best_move_metric: AccuracyMetric,
    mate_depth_metric: AccuracyMetric,
    failure_reasons: Counter[str],
    output_path: Path,
) -> str:
    avg_score = "N/A" if avg_judge_score is None else f"{avg_judge_score:.4f}"
    top_reasons = failure_reasons.most_common(5)
    reason_lines = (
        ["none"]
        if not top_reasons
        else [f"- {reason} ({count})" for reason, count in top_reasons]
    )

    return "\n".join(
        [
            "=== Chess Eval Report ===",
            f"total examples: {total_examples}",
            f"passed examples: {passed_examples}",
            f"failed examples: {failed_examples}",
            f"average OpenAI judge score: {avg_score}",
            f"FEN accuracy: {fen_metric.render()}",
            f"best move accuracy: {best_move_metric.render()}",
            f"mate depth accuracy: {mate_depth_metric.render()}",
            "common failure reasons:",
            *reason_lines,
            f"markdown report: {output_path}",
        ]
    )


def _render_markdown_report(
    *,
    total_examples: int,
    passed_examples: int,
    failed_examples: int,
    avg_judge_score: float | None,
    fen_metric: AccuracyMetric,
    best_move_metric: AccuracyMetric,
    mate_depth_metric: AccuracyMetric,
    failure_reasons: Counter[str],
    summary_path: Path,
    results_path: Path,
) -> str:
    generated_at = datetime.now(timezone.utc).isoformat()
    avg_score = "N/A" if avg_judge_score is None else f"{avg_judge_score:.4f}"
    table_rows = [
        ("Total examples", str(total_examples)),
        ("Passed examples", str(passed_examples)),
        ("Failed examples", str(failed_examples)),
        ("Average OpenAI judge score", avg_score),
        ("FEN accuracy", fen_metric.render()),
        ("Best move accuracy", best_move_metric.render()),
        ("Mate depth accuracy", mate_depth_metric.render()),
    ]

    lines = [
        "# Latest Chess Eval Report",
        "",
        f"- Generated (UTC): `{generated_at}`",
        f"- Summary source: `{summary_path}`",
        f"- Results source: `{results_path}`",
        "",
        "| Metric | Value |",
        "| --- | --- |",
    ]
    lines.extend([f"| {name} | {value} |" for name, value in table_rows])
    lines.append("")
    lines.append("## Common Failure Reasons")
    if failure_reasons:
        lines.extend(
            [
                f"- {reason} ({count})"
                for reason, count in failure_reasons.most_common(10)
            ]
        )
    else:
        lines.append("- none")
    lines.append("")
    return "\n".join(lines)


def generate_report(summary_path: Path, results_path: Path, output_path: Path) -> str:
    summary = _read_json(summary_path)
    records = _read_jsonl(results_path)

    passed_values = [
        _extract_passed(record, _extract_checks(record)) for record in records
    ]
    total_examples = len(records)
    passed_examples = sum(1 for value in passed_values if value is True)
    failed_examples = sum(1 for value in passed_values if value is False)

    summary_total = _first_int(
        summary,
        ("total_examples", "total_cases", "total", "num_examples", "example_count"),
    )
    summary_passed = _first_int(
        summary, ("passed_examples", "passed", "num_passed", "passed_count")
    )
    summary_failed = _first_int(
        summary, ("failed_examples", "failed", "num_failed", "failed_count")
    )

    if total_examples == 0 and summary_total is not None:
        total_examples = summary_total
    if passed_examples == 0 and summary_passed is not None:
        passed_examples = summary_passed
    if failed_examples == 0 and summary_failed is not None:
        failed_examples = summary_failed
    if failed_examples == 0 and total_examples >= passed_examples:
        failed_examples = total_examples - passed_examples

    judge_values = [
        score
        for score in (_extract_judge_score(record) for record in records)
        if score is not None
    ]
    avg_judge_score = (sum(judge_values) / len(judge_values)) if judge_values else None
    if avg_judge_score is None:
        avg_judge_score = _first_number(
            summary,
            (
                "average_openai_judge_score",
                "avg_openai_judge_score",
                "openai_judge_average_score",
                "average_judge_score",
            ),
        )

    fen_metric = _metric_from_checks(
        records=records,
        aliases=("expected_fen_match", "fen_validity", "fen_match"),
        label="FEN accuracy",
    )
    best_move_metric = _metric_from_checks(
        records=records,
        aliases=("expected_best_move_match", "best_move_match"),
        label="best move accuracy",
    )
    mate_depth_metric = _metric_from_checks(
        records=records,
        aliases=("expected_mate_depth_match", "mate_depth_match"),
        label="mate depth accuracy",
    )
    failure_reasons = _collect_failure_reasons(records, passed_values)

    console_report = _render_console_report(
        total_examples=total_examples,
        passed_examples=passed_examples,
        failed_examples=failed_examples,
        avg_judge_score=avg_judge_score,
        fen_metric=fen_metric,
        best_move_metric=best_move_metric,
        mate_depth_metric=mate_depth_metric,
        failure_reasons=failure_reasons,
        output_path=output_path,
    )

    markdown_report = _render_markdown_report(
        total_examples=total_examples,
        passed_examples=passed_examples,
        failed_examples=failed_examples,
        avg_judge_score=avg_judge_score,
        fen_metric=fen_metric,
        best_move_metric=best_move_metric,
        mate_depth_metric=mate_depth_metric,
        failure_reasons=failure_reasons,
        summary_path=summary_path,
        results_path=results_path,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown_report, encoding="utf-8")
    return console_report


def parse_args() -> argparse.Namespace:
    evals_dir = Path(__file__).resolve().parent
    reports_dir = evals_dir / "reports"

    parser = argparse.ArgumentParser(description="Generate a local chess eval report.")
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
    parser.add_argument(
        "--output-path",
        type=Path,
        default=reports_dir / "latest_eval_report.md",
        help="Output markdown path.",
    )
    args = parser.parse_args()

    args.summary_path = _resolve_input_path(
        args.summary_path,
        fallback_locations=(
            reports_dir / "eval_summary.json",
            evals_dir / "eval_summary.json",
            Path.cwd() / "eval_summary.json",
        ),
    )
    args.results_path = _resolve_input_path(
        args.results_path,
        fallback_locations=(
            reports_dir / "eval_results.jsonl",
            evals_dir / "eval_results.jsonl",
            Path.cwd() / "eval_results.jsonl",
        ),
    )
    return args


def main() -> None:
    args = parse_args()
    report = generate_report(
        summary_path=args.summary_path,
        results_path=args.results_path,
        output_path=args.output_path,
    )
    print(report)


if __name__ == "__main__":
    main()
