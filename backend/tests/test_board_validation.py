from __future__ import annotations

import unittest

from app.services.board_validation import validate_fen


class BoardValidationTests(unittest.TestCase):
    def test_valid_fen_passes(self) -> None:
        result = validate_fen("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
        self.assertTrue(result.fen_parses)
        self.assertTrue(result.passed)

    def test_missing_black_king_fails(self) -> None:
        result = validate_fen("8/8/8/8/8/8/8/4K3 w - - 0 1")
        self.assertFalse(result.passed)
        self.assertIn("Expected exactly one black king.", result.reasons)

    def test_adjacent_kings_fail(self) -> None:
        result = validate_fen("8/8/8/8/8/8/8/3kK3 w - - 0 1")
        self.assertFalse(result.passed)
        self.assertIn("Kings are adjacent or missing.", result.reasons)

    def test_pawn_on_first_rank_fails(self) -> None:
        result = validate_fen("8/8/8/8/8/8/4k3/3PK3 w - - 0 1")
        self.assertFalse(result.passed)
        self.assertIn("Pawn on rank 1 or 8 detected.", result.reasons)

    def test_side_to_move_must_be_explicit(self) -> None:
        # Missing side-to-move field in FEN.
        result = validate_fen("8/8/8/8/8/8/4k3/4K3")
        self.assertFalse(result.passed)
        self.assertIn("Side to move is not explicit in FEN.", result.reasons)


if __name__ == "__main__":
    unittest.main()
