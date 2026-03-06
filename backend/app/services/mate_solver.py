from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import chess
import chess.engine


@dataclass
class MateLine:
    mate_in: int
    moves_uci: List[str]
    moves_san: List[str]


def _pv_to_san(board: chess.Board, pv: List[chess.Move]) -> List[str]:
    b = board.copy()
    san: List[str] = []
    for mv in pv:
        san.append(b.san(mv))
        b.push(mv)
    return san


def find_mate_in_1_to_3(
    fen: str,
    stockfish_path: str,
    think_time_s: float = 2.0,
    max_depth: int = 22,
) -> Optional[MateLine]:
    """
    Returns the best forced mate line if Stockfish sees mate in 1/2/3 for side to move.
    Returns None if no mate in 1..3 is found.
    """
    board = chess.Board(fen)

    with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
        info = engine.analyse(
            board,
            chess.engine.Limit(time=think_time_s, depth=max_depth),
            multipv=1,
        )

        score = info.get("score")
        pv = info.get("pv") or []

        if score is None:
            return None

        mate = score.pov(board.turn).mate()
        if mate is None:
            return None

        mate_in = abs(int(mate))
        if mate_in < 1 or mate_in > 3:
            return None

        moves_uci = [m.uci() for m in pv]
        moves_san = _pv_to_san(board, pv)

        # For mate-in-N, PV should be at least N plies (often more).
        return MateLine(mate_in=mate_in, moves_uci=moves_uci, moves_san=moves_san)