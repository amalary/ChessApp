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
            "Load a puzzle first",
            result.get("response_text", ""),
        )

    def test_does_not_mix_unrelated_history_solution_with_live_fen(self) -> None:
        result = self.agent.run(
            user_id="auth0|test-user",
            puzzle_id="puzzle-123",
            fen="8/8/8/8/8/8/8/K6k w - - 0 1",
            solver_move_san=None,
            solver_line=None,
            user_message="Explain this puzzle",
            requested_mode="explain",
            user_puzzle_history=[
                {
                    "fileName": "different-puzzle.png",
                    "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
                    "solutionLines": ["e4"],
                }
            ],
        )
        self.assertIn(
            "Solve the puzzle first",
            result.get("response_text", ""),
        )

    def test_recently_solved_phrase_uses_history_summary(self) -> None:
        result = self.agent.run(
            user_id="auth0|test-user",
            puzzle_id=None,
            fen=None,
            solver_move_san=None,
            solver_line=None,
            user_message="Can you show my recently solved puzzles?",
            requested_mode="followup",
            user_puzzle_history=[
                {
                    "fileName": "recent-puzzle.png",
                    "fen": "8/8/8/8/8/8/8/K6k w - - 0 1",
                    "solutionLines": ["Kb2"],
                    "puzzleElo": 1200,
                }
            ],
        )
        self.assertIn(
            "stored puzzles",
            result.get("response_text", "").lower(),
        )
        self.assertNotIn(
            "recent-puzzle.png",
            result.get("response_text", "").lower(),
        )

    def test_supports_recent_history_with_snake_case_keys(self) -> None:
        result = self.agent.run(
            user_id="auth0|test-user",
            puzzle_id=None,
            fen=None,
            solver_move_san=None,
            solver_line=None,
            user_message="Explain my latest solved puzzle",
            requested_mode="explain",
            user_puzzle_history=[
                {
                    "fileName": "recent-snake.png",
                    "FEN": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
                    "solution_lines": ["e4"],
                    "puzzleElo": 1300,
                }
            ],
        )
        self.assertIn(
            "best move",
            result.get("response_text", "").lower(),
        )

    def test_matches_history_when_fen_differs_only_by_move_counters(self) -> None:
        result = self.agent.run(
            user_id="auth0|test-user",
            puzzle_id="puzzle-123",
            fen="8/8/8/8/8/8/8/K6k w - - 0 1",
            solver_move_san=None,
            solver_line=None,
            user_message="Explain this puzzle",
            requested_mode="explain",
            user_puzzle_history=[
                {
                    "fileName": "same-position-different-counters.png",
                    "fen": "8/8/8/8/8/8/8/K6k w - - 17 42",
                    "solutionLines": ["Kb2"],
                }
            ],
        )
        self.assertIn(
            "best move",
            result.get("response_text", "").lower(),
        )


if __name__ == "__main__":
    unittest.main()
