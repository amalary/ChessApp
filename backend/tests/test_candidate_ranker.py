from __future__ import annotations

import unittest

from app.services.board_validate import CandidateBoard
from app.services.board_validation import validate_fen
from app.services.candidate_ranker import rank_candidates
from app.services.mate_solver import MateLine


class CandidateRankerTests(unittest.TestCase):
    def test_prefers_mate_candidate(self) -> None:
        c1 = CandidateBoard(
            fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1",
            source="a",
            board_map={},
            side_to_move="white",
            repair_applied=False,
            validation=validate_fen("4k3/8/8/8/8/8/8/4K3 w - - 0 1"),
            confidence=0.8,
            uncertain_squares=[],
        )
        c2 = CandidateBoard(
            fen="4k3/8/8/8/8/8/8/3RK3 w - - 0 1",
            source="b",
            board_map={},
            side_to_move="white",
            repair_applied=False,
            validation=validate_fen("4k3/8/8/8/8/8/8/3RK3 w - - 0 1"),
            confidence=0.7,
            uncertain_squares=[],
        )
        mate_by_fen = {
            c1.fen: None,
            c2.fen: MateLine(mate_in=1, moves_uci=["d1d8"], moves_san=["Rd8#"]),
        }
        ranked = rank_candidates([c1, c2], mate_by_fen=mate_by_fen, side_hint="white")
        self.assertEqual(ranked[0].candidate.fen, c2.fen)


if __name__ == "__main__":
    unittest.main()

