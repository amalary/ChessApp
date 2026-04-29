from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

import chess


@dataclass
class ValidationResult:
    fen: str
    side_explicit: bool
    fen_parses: bool
    one_white_king: bool
    one_black_king: bool
    kings_not_adjacent: bool
    pawns_on_valid_ranks: bool
    board_plausible: bool
    legal_position: bool
    passed: bool
    reasons: List[str] = field(default_factory=list)


def _kings_not_adjacent(board: chess.Board) -> bool:
    wk = board.king(chess.WHITE)
    bk = board.king(chess.BLACK)
    if wk is None or bk is None:
        return False
    wf, wr = chess.square_file(wk), chess.square_rank(wk)
    bf, br = chess.square_file(bk), chess.square_rank(bk)
    return max(abs(wf - bf), abs(wr - br)) > 1


def _pawns_on_valid_ranks(board: chess.Board) -> bool:
    for sq, piece in board.piece_map().items():
        if piece.piece_type != chess.PAWN:
            continue
        rank = chess.square_rank(sq)  # 0-based: rank 1 => 0, rank 8 => 7
        if rank in (0, 7):
            return False
    return True


def validate_fen(fen: str) -> ValidationResult:
    parts = fen.strip().split()
    side_explicit = len(parts) >= 2 and parts[1] in {"w", "b"}

    try:
        board = chess.Board(fen)
    except Exception:
        return ValidationResult(
            fen=fen,
            side_explicit=side_explicit,
            fen_parses=False,
            one_white_king=False,
            one_black_king=False,
            kings_not_adjacent=False,
            pawns_on_valid_ranks=False,
            board_plausible=False,
            legal_position=False,
            passed=False,
            reasons=["FEN failed to parse."],
        )

    pieces = list(board.piece_map().values())
    white_kings = sum(1 for p in pieces if p.symbol() == "K")
    black_kings = sum(1 for p in pieces if p.symbol() == "k")
    one_white_king = white_kings == 1
    one_black_king = black_kings == 1
    kings_not_adj = _kings_not_adjacent(board)
    pawns_ok = _pawns_on_valid_ranks(board)
    plausible = board.is_valid()

    reasons: list[str] = []
    if not side_explicit:
        reasons.append("Side to move is not explicit in FEN.")
    if not one_white_king:
        reasons.append("Expected exactly one white king.")
    if not one_black_king:
        reasons.append("Expected exactly one black king.")
    if not kings_not_adj:
        reasons.append("Kings are adjacent or missing.")
    if not pawns_ok:
        reasons.append("Pawn on rank 1 or 8 detected.")
    if not plausible:
        reasons.append("Board state is not plausible/legal per python-chess.")

    passed = (
        side_explicit
        and one_white_king
        and one_black_king
        and kings_not_adj
        and pawns_ok
        and plausible
    )

    return ValidationResult(
        fen=fen,
        side_explicit=side_explicit,
        fen_parses=True,
        one_white_king=one_white_king,
        one_black_king=one_black_king,
        kings_not_adjacent=kings_not_adj,
        pawns_on_valid_ranks=pawns_ok,
        board_plausible=plausible,
        legal_position=plausible,
        passed=passed,
        reasons=reasons,
    )
