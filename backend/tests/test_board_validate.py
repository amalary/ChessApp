from __future__ import annotations

import unittest

from app.services.board_validate import build_candidates
from app.services.square_extract import SQUARES


class BoardValidateTests(unittest.TestCase):
    def test_build_candidates_deduplicates_identical_fens(self) -> None:
        board_map = {sq: "." for sq in SQUARES}
        board_map["e1"] = "K"

        candidates = build_candidates(
            board_map=board_map,
            side_options=["white"],
            base_confidence=0.8,
            uncertain_squares=[],
        )

        fens = [candidate.fen for candidate in candidates]
        self.assertEqual(len(fens), len(set(fens)))


if __name__ == "__main__":
    unittest.main()
