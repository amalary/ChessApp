from __future__ import annotations

import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from app.services.puzzle_submission_service import (
    build_difficulty_bucket_analytics,
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
            difficulty_rating=1500,
            estimated_difficulty_rating=1480,
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
        self.assertEqual(mapped.difficultyRating, 1500)
        self.assertEqual(mapped.estimatedDifficultyRating, 1480)
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
            difficulty_rating=None,
            estimated_difficulty_rating=None,
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

    def test_difficulty_bucket_analytics_excludes_invalid_attempts(self) -> None:
        valid_correct = SimpleNamespace(
            fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1",
            solve_time_ms=10000,
            puzzle_elo=900,
            difficulty_rating=900,
            estimated_difficulty_rating=None,
            position_check={"confidence": 0.91, "mateFound": True, "mateIn": 1, "attemptsUsed": 1},
            solution_lines=["Qh7#"],
            first_move_assessment={
                "isFirstMoveCorrect": True,
                "isValidForFirstMoveAccuracy": True,
            },
        )
        valid_incorrect = SimpleNamespace(
            fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1",
            solve_time_ms=20000,
            puzzle_elo=1250,
            difficulty_rating=1250,
            estimated_difficulty_rating=None,
            position_check={"confidence": 0.88, "mateFound": True, "mateIn": 2, "attemptsUsed": 1},
            solution_lines=["Qg7#"],
            first_move_assessment={
                "isFirstMoveCorrect": False,
                "isValidForFirstMoveAccuracy": True,
            },
        )
        low_confidence = SimpleNamespace(
            fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1",
            solve_time_ms=12000,
            puzzle_elo=1300,
            difficulty_rating=1300,
            estimated_difficulty_rating=None,
            position_check={"confidence": 0.6, "mateFound": True, "mateIn": 2, "attemptsUsed": 1},
            solution_lines=["Qg7#"],
            first_move_assessment={
                "isFirstMoveCorrect": True,
                "isValidForFirstMoveAccuracy": True,
            },
        )

        summary = build_difficulty_bucket_analytics(
            rows=[valid_correct, valid_incorrect, low_confidence],
            confidence_threshold=0.75,
        )

        self.assertEqual(summary.total_valid_attempts, 2)
        buckets = {bucket.label: bucket for bucket in summary.difficulty_buckets}
        self.assertEqual(buckets["800-1200"].total_attempts, 1)
        self.assertEqual(buckets["800-1200"].correct_attempts, 1)
        self.assertEqual(buckets["1200-1600"].total_attempts, 1)
        self.assertEqual(buckets["1200-1600"].correct_attempts, 0)
        self.assertEqual(buckets["1200-1600"].accuracy_percentage, 0.0)


if __name__ == "__main__":
    unittest.main()
