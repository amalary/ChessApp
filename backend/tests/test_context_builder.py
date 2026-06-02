from __future__ import annotations

import unittest

from app.agent.context_builder import DEFAULT_CONTEXT_LIMITS, build_agent_context


class ContextBuilderTests(unittest.TestCase):
    def test_build_agent_context_includes_expected_sections_in_order(self) -> None:
        user = {
            "elo": 1720,
            "training_goals": ["improve calculation"],
        }
        puzzle = {
            "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/8/3P4/PPP1PPPP/RNBQKBNR w KQkq - 0 3",
            "theme": ["fork"],
            "stockfish_best_line": ["Nf3", "Nc6", "Nxe5"],
            "analysis": {"summary": "White wins material with tactical pressure."},
        }
        messages = [
            {"role": "user", "content": "Can you explain this puzzle?"},
            {"role": "assistant", "content": "Sure, start with forcing moves."},
            {
                "role": "user",
                "content": "What about the app docs for puzzle lab?",
                "metadata": {
                    "retrieval_results": [
                        {
                            "source_file": "docs/puzzle-lab.md",
                            "chunk_text": "Puzzle Lab lets users train specific tactical motifs.",
                        }
                    ]
                },
            },
        ]

        context = build_agent_context(
            user=user,
            puzzle=puzzle,
            messages=messages,
            user_query="How should I think through this position?",
        )

        expected_order = [
            "SYSTEM:",
            "USER PROFILE:",
            "CURRENT PUZZLE:",
            "RELEVANT DOCUMENTATION:",
            "RECENT CONVERSATION:",
            "CURRENT USER MESSAGE:",
        ]

        positions: list[int] = []
        for section in expected_order:
            self.assertIn(section, context)
            positions.append(context.index(section))

        self.assertEqual(positions, sorted(positions))
        self.assertIn("ENGINE ANALYSIS:", context)
        self.assertIn("docs/puzzle-lab.md", context)
        self.assertIn("How should I think through this position?", context)

    def test_build_agent_context_is_bounded(self) -> None:
        long_text = "x" * 30_000
        user = {
            "profile": {
                "bio": long_text,
                "training_goals": [long_text, long_text],
            }
        }
        puzzle = {
            "fen": "8/8/8/8/8/8/8/8 w - - 0 1",
            "analysis": {"summary": long_text},
            "retrieval_results": [
                {
                    "source_file": "docs/very-long.md",
                    "chunk_text": long_text,
                }
                for _ in range(20)
            ],
        }
        messages = [
            {"role": "user", "content": long_text},
            {"role": "assistant", "content": long_text},
        ] * 30

        context = build_agent_context(
            user=user,
            puzzle=puzzle,
            messages=messages,
            user_query=long_text,
        )

        self.assertLessEqual(len(context), DEFAULT_CONTEXT_LIMITS.max_total_chars)

    def test_build_agent_context_uses_safe_fallbacks_when_data_missing(self) -> None:
        context = build_agent_context(
            user=None,
            puzzle=None,
            messages=None,
            user_query="",
        )

        self.assertIn("RELEVANT DOCUMENTATION:\n(No relevant documentation retrieved.)", context)
        self.assertIn("CURRENT USER MESSAGE:\n(No user message provided.)", context)


if __name__ == "__main__":
    unittest.main()
