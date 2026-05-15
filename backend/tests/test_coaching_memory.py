from __future__ import annotations

import unittest

from app.services.coaching_memory import (
    build_conversational_memory,
    build_emotional_context,
    build_memory_reference,
)


class CoachingMemoryTests(unittest.TestCase):
    def test_improvement_trend_and_knight_strength_detected(self) -> None:
        history = [
            {
                "firstMoveCorrect": True,
                "firstMoveStatus": "correct",
                "solutionLines": ["Nf7+"],
                "difficultyRating": 1750,
            },
            {
                "firstMoveCorrect": True,
                "firstMoveStatus": "correct",
                "solutionLines": ["Ne6+"],
                "difficultyRating": 1720,
            },
            {
                "firstMoveCorrect": True,
                "firstMoveStatus": "correct",
                "solutionLines": ["Nd6+"],
                "difficultyRating": 1600,
            },
            {
                "firstMoveCorrect": False,
                "firstMoveStatus": "incorrect",
                "solutionLines": ["Qh5+"],
                "difficultyRating": 1400,
            },
            {
                "firstMoveCorrect": False,
                "firstMoveStatus": "incorrect",
                "solutionLines": ["Qh5+"],
                "difficultyRating": 1350,
            },
            {
                "firstMoveCorrect": False,
                "firstMoveStatus": "incorrect",
                "solutionLines": ["Qh5+"],
                "difficultyRating": 1300,
            },
        ]
        memory = build_conversational_memory(history=history, user_message="hint")
        emotional = build_emotional_context(memory)
        reference = build_memory_reference(memory)

        self.assertIn("knight forks", memory["puzzle_strengths"])
        self.assertEqual(emotional["tone"], "impressed")
        self.assertEqual(reference, "You usually spot knight forks quickly.")

    def test_fast_failures_trigger_rushing_emotional_context(self) -> None:
        history = [
            {
                "firstMoveCorrect": False,
                "firstMoveStatus": "incorrect",
                "solveTimeMs": 6000,
                "solutionLines": ["Qh4#"],
            },
            {
                "firstMoveCorrect": False,
                "firstMoveStatus": "incorrect",
                "solveTimeMs": 7000,
                "solutionLines": ["Qh4#"],
            },
        ]
        memory = build_conversational_memory(history=history, user_message="hint 1")
        emotional = build_emotional_context(memory)

        self.assertIn("rushing", emotional["cue"].lower())
        self.assertEqual(emotional["pace"], "slow")


if __name__ == "__main__":
    unittest.main()
