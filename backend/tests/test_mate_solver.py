from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import chess
import chess.engine

from app.services.mate_solver import EngineCrashedError, MateLine, find_mate_in_1_to_3


class MateSolverTests(unittest.TestCase):
    def _mock_engine_context(self, analyse_result=None, analyse_side_effect=None) -> MagicMock:
        engine = MagicMock()
        if analyse_side_effect is not None:
            engine.analyse.side_effect = analyse_side_effect
        else:
            engine.analyse.return_value = analyse_result
        context = MagicMock()
        context.__enter__.return_value = engine
        context.__exit__.return_value = False
        return context

    def test_returns_mate_line_when_mate_within_limit(self) -> None:
        info = {
            "score": chess.engine.PovScore(chess.engine.Mate(2), chess.WHITE),
            "pv": [chess.Move.from_uci("e1e2")],
        }
        context = self._mock_engine_context(analyse_result=info)
        with patch("app.services.mate_solver.chess.engine.SimpleEngine.popen_uci", return_value=context):
            result = find_mate_in_1_to_3(
                fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1",
                stockfish_path="stockfish",
                max_mate=3,
            )
        self.assertIsInstance(result, MateLine)
        assert result is not None
        self.assertEqual(result.mate_in, 2)

    def test_returns_none_when_mate_exceeds_limit(self) -> None:
        info = {
            "score": chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE),
            "pv": [],
        }
        context = self._mock_engine_context(analyse_result=info)
        with patch("app.services.mate_solver.chess.engine.SimpleEngine.popen_uci", return_value=context):
            result = find_mate_in_1_to_3(
                fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1",
                stockfish_path="stockfish",
                max_mate=2,
            )
        self.assertIsNone(result)

    def test_raises_engine_crashed_error_on_engine_failures(self) -> None:
        context = self._mock_engine_context(
            analyse_side_effect=chess.engine.EngineError("engine crashed"),
        )
        with patch("app.services.mate_solver.chess.engine.SimpleEngine.popen_uci", return_value=context):
            with self.assertRaises(EngineCrashedError):
                find_mate_in_1_to_3(
                    fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1",
                    stockfish_path="stockfish",
                )


if __name__ == "__main__":
    unittest.main()
