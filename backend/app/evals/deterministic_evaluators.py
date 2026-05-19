from __future__ import annotations

from typing import TypedDict

import chess


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
        # Fallback for SAN/textual move strings.
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


def evaluate_stockfish_success(
    stockfish_succeeded: bool,
) -> EvalResult:
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
