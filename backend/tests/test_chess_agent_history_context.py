from __future__ import annotations

import unittest

from app.services.chess_agent import ChessAssistantAgent


class ChessAssistantHistoryContextTests(unittest.TestCase):
    def setUp(self) -> None:
        self.agent = ChessAssistantAgent()

    def test_uses_latest_history_when_live_context_missing(self) -> None:
        result = self.agent.run(
            user_id="auth0|test-user",
            puzzle_id=None,
            fen=None,
            solver_move_san=None,
            solver_line=None,
            user_message="Explain my last puzzle",
            requested_mode="explain",
            user_puzzle_history=[
                {
                    "fileName": "recent-puzzle.png",
                    "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
                    "solutionLines": ["e4"],
                }
            ],
        )

        self.assertNotIn(
            "Please solve or upload a puzzle first",
            result.get("response_text", ""),
        )
        self.assertIn(
            "best move",
            result.get("response_text", "").lower(),
        )

    def test_keeps_missing_context_message_when_no_history(self) -> None:
        result = self.agent.run(
            user_id="auth0|test-user",
            puzzle_id=None,
            fen=None,
            solver_move_san=None,
            solver_line=None,
            user_message="Explain my last puzzle",
            requested_mode="explain",
            user_puzzle_history=[],
        )
        self.assertIn(
            "Please solve or upload a puzzle first",
            result.get("response_text", ""),
        )


if __name__ == "__main__":
    unittest.main()
