from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List

import chess

from app.services.board_validation import ValidationResult, validate_fen
from app.services.square_extract import FILES, RANKS, SQUARES


@dataclass
class CandidateBoard:
    fen: str
    source: str
    board_map: Dict[str, str]
    side_to_move: str
    repair_applied: bool
    validation: ValidationResult
    confidence: float
    uncertain_squares: List[str]


def board_map_to_fen(board_map: Dict[str, str], side_to_move: str) -> str:
    rows: list[str] = []
    for rank in RANKS:
        empty = 0
        row = ""
        for file in FILES:
            piece = board_map.get(f"{file}{rank}", ".")
            if piece == ".":
                empty += 1
            else:
                if empty:
                    row += str(empty)
                    empty = 0
                row += piece
        if empty:
            row += str(empty)
        rows.append(row)
    stm = "w" if side_to_move.lower().startswith("w") else "b"
    return f"{'/'.join(rows)} {stm} - - 0 1"


def rotate_board_map_180(board_map: Dict[str, str]) -> Dict[str, str]:
    out = {sq: "." for sq in SQUARES}
    for square, piece in board_map.items():
        if square not in out:
            continue
        sq = chess.parse_square(square)
        mapped = chess.square_name(chess.square(7 - chess.square_file(sq), 7 - chess.square_rank(sq)))
        out[mapped] = piece
    return out


def _repair_board_map(board_map: Dict[str, str], uncertain_squares: Iterable[str]) -> Dict[str, str]:
    fixed = dict(board_map)
    uncertain_set = set(uncertain_squares)

    # Remove pawns on rank 1/8 (invalid terminal state).
    for f in FILES:
        for sq in (f"{f}1", f"{f}8"):
            if fixed.get(sq) in {"P", "p"}:
                fixed[sq] = "."

    # Ensure one king each by removing extras from uncertain squares first.
    for king in ("K", "k"):
        squares = [sq for sq, piece in fixed.items() if piece == king]
        if len(squares) <= 1:
            continue
        keep = next((sq for sq in squares if sq not in uncertain_set), squares[0])
        for sq in squares:
            if sq != keep:
                fixed[sq] = "."
    return fixed


def build_candidates(
    board_map: Dict[str, str],
    side_options: Iterable[str],
    base_confidence: float,
    uncertain_squares: List[str],
) -> List[CandidateBoard]:
    candidates: List[CandidateBoard] = []

    orientations = [
        ("as_detected", board_map),
        ("rotated_180", rotate_board_map_180(board_map)),
    ]

    for orient_name, oriented_map in orientations:
        for side in side_options:
            fen = board_map_to_fen(oriented_map, side)
            val = validate_fen(fen)
            candidates.append(
                CandidateBoard(
                    fen=fen,
                    source=f"{orient_name}_side_{side}",
                    board_map=dict(oriented_map),
                    side_to_move=side,
                    repair_applied=False,
                    validation=val,
                    confidence=base_confidence,
                    uncertain_squares=uncertain_squares,
                )
            )

            if not val.passed:
                repaired = _repair_board_map(oriented_map, uncertain_squares)
                fen2 = board_map_to_fen(repaired, side)
                val2 = validate_fen(fen2)
                candidates.append(
                    CandidateBoard(
                        fen=fen2,
                        source=f"{orient_name}_side_{side}_repaired",
                        board_map=repaired,
                        side_to_move=side,
                        repair_applied=True,
                        validation=val2,
                        confidence=max(0.0, base_confidence - 0.08),
                        uncertain_squares=uncertain_squares,
                    )
                )
    return candidates

