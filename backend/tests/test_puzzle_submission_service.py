from __future__ import annotations

import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from app.services.puzzle_submission_service import (
    list_submissions_for_user,
    map_submission,
)


class PuzzleSubmissionServiceTests(unittest.TestCase):
    def test_map_submission_normalizes_shape(self) -> None:
        row = SimpleNamespace(
            id=uuid4(),
            file_name="puzzle.png",
            created_at=datetime(2026, 1, 1, 12, 0, 0),
            expected_side_to_move="unexpected",
            fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1",
            solve_time_ms=1234,
            puzzle_elo=1500,
            position_check={
                "sideToMove": "white",
                "confidence": 0.99,
                "attemptsUsed": 2,
                "mateFound": True,
                "mateIn": 2,
                "ignored": "field",
            },
            solution_lines=["Qh7#"],
            first_move_assessment={"quality": "best"},
        )

        mapped = map_submission(row)
        self.assertEqual(mapped.fileName, "puzzle.png")
        self.assertEqual(mapped.expectedSideToMove, "white")
        self.assertEqual(mapped.positionCheck["sideToMove"], "white")
        self.assertEqual(mapped.positionCheck["confidence"], 0.99)
        self.assertEqual(mapped.solutionLines, ["Qh7#"])
        self.assertEqual(mapped.firstMoveAssessment, {"quality": "best"})

    def test_list_submissions_for_user_uses_repository_layer(self) -> None:
        user = SimpleNamespace(id=uuid4())
        db = object()
        row = SimpleNamespace(
            id=uuid4(),
            file_name="puzzle.png",
            created_at=datetime(2026, 1, 1, 12, 0, 0),
            expected_side_to_move="white",
            fen=None,
            solve_time_ms=None,
            puzzle_elo=None,
            position_check=None,
            solution_lines=[],
            first_move_assessment=None,
        )

        with patch(
            "app.services.puzzle_submission_service.puzzle_submissions.ensure_table"
        ) as ensure_table, patch(
            "app.services.puzzle_submission_service.puzzle_submissions.list_for_user",
            return_value=[row],
        ) as list_for_user:
            result = list_submissions_for_user(db=db, current_user=user, limit=25)

        ensure_table.assert_called_once_with(db)
        list_for_user.assert_called_once_with(db=db, user_id=user.id, limit=25)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].fileName, "puzzle.png")


if __name__ == "__main__":
    unittest.main()

