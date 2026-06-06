from __future__ import annotations

import os
import time
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi import UploadFile
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.middleware.rate_limit_middleware import rate_limit_middleware
from app.services import gemini_fen, protection_service


def _request(
    path: str = "/solve", *, remote_ip: str = "127.0.0.1", xff: str | None = None
):
    headers: list[tuple[bytes, bytes]] = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode("utf-8")))
    app = SimpleNamespace(
        state=SimpleNamespace(
            redis_client=SimpleNamespace(ttl=AsyncMock(return_value=-2))
        )
    )
    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "headers": headers,
        "client": (remote_ip, 12345),
        "state": {},
        "app": app,
    }
    req = Request(scope)
    req.state.user_id = None
    req.state.client_ip = remote_ip
    return req


def _png_bytes(width: int = 16, height: int = 16) -> bytes:
    from PIL import Image

    image = Image.new("RGB", (width, height), color=(100, 20, 20))
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


class SolveProtectionHardeningTests(unittest.IsolatedAsyncioTestCase):
    async def test_rate_limit_middleware_allows_requests_without_redis(self) -> None:
        req = _request(path="/", remote_ip="127.0.0.1")
        req.app.state.redis_client = None
        call_count = 0

        async def _call_next(_request: Request):
            nonlocal call_count
            call_count += 1
            return JSONResponse({"message": "Backend is running"})

        response = await rate_limit_middleware(req, _call_next)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(call_count, 1)

    async def test_validate_upload_accepts_real_png_and_sanitizes_name(self) -> None:
        req = _request()
        upload = UploadFile(
            filename="../../odd name!!.png",
            file=BytesIO(_png_bytes()),
            headers={"content-type": "image/png"},
        )

        result = await protection_service.validate_solve_upload(req, upload)
        self.assertEqual(result.content_type, "image/png")
        self.assertTrue(result.filename.endswith(".png"))
        self.assertNotIn("/", result.filename)
        self.assertNotIn("\\", result.filename)
        self.assertGreater(len(result.data), 0)

    async def test_validate_upload_allows_solve_without_redis(self) -> None:
        req = _request()
        req.app.state.redis_client = None
        upload = UploadFile(
            filename="board.png",
            file=BytesIO(_png_bytes()),
            headers={"content-type": "image/png"},
        )

        result = await protection_service.validate_solve_upload(req, upload)

        self.assertEqual(result.content_type, "image/png")
        self.assertEqual(result.filename, "board.png")

    @patch(
        "app.services.protection_service.record_failed_solve_attempt",
        new_callable=AsyncMock,
    )
    async def test_validate_upload_rejects_content_type_mismatch(
        self, _mock_record_failed: AsyncMock
    ) -> None:
        req = _request()
        upload = UploadFile(
            filename="board.png",
            file=BytesIO(_png_bytes()),
            headers={"content-type": "image/jpeg"},
        )
        with self.assertRaises(HTTPException):
            await protection_service.validate_solve_upload(req, upload)

    def test_client_ip_ignores_xff_when_remote_not_trusted_proxy(self) -> None:
        req = _request(path="/", remote_ip="8.8.8.8", xff="1.2.3.4")
        self.assertEqual(protection_service.client_ip(req), "8.8.8.8")

    def test_client_ip_uses_xff_from_trusted_proxy(self) -> None:
        req = _request(path="/", remote_ip="127.0.0.1", xff="1.2.3.4")
        self.assertEqual(protection_service.client_ip(req), "1.2.3.4")

    async def test_solve_endpoint_enforces_solve_specific_limits(self) -> None:
        req = _request(path="/solve")
        redis_client = object()
        seen_reasons: list[str] = []

        async def _fake_enforce(*, rule, **_kwargs):
            seen_reasons.append(rule.reason)
            return None

        with patch(
            "app.services.protection_service._enforce_fixed_window_rule",
            side_effect=_fake_enforce,
        ):
            response = await protection_service.enforce_global_limits(req, redis_client)

        self.assertIsNone(response)
        self.assertIn("solve_ip_rate_limit", seen_reasons)

    async def test_engine_lock_allows_solve_without_redis(self) -> None:
        req = _request(path="/solve")
        req.app.state.redis_client = None

        lock_context = protection_service.enforce_engine_lock(req)
        yielded = await lock_context.__anext__()

        self.assertIsNone(yielded)
        with self.assertRaises(StopAsyncIteration):
            await lock_context.__anext__()

    async def test_solve_returns_solution_when_submission_persistence_fails(
        self,
    ) -> None:
        from app import main

        req = _request(path="/solve")
        upload = protection_service.ValidatedSolveUpload(
            data=_png_bytes(),
            filename="board.png",
            content_type="image/png",
        )
        mate_line = SimpleNamespace(
            mate_in=1,
            moves_san=["Qh4#"],
            moves_uci=["d8h4"],
        )
        db = SimpleNamespace(rollback=lambda: None)

        with patch(
            "app.main.fen_from_image_bytes",
            return_value={
                "fen": "6k1/5ppp/8/8/8/8/5PPP/6KQ w - - 0 1",
                "confidence": 0.91,
                "attempts_used": 1,
                "raw_output": "{}",
            },
        ), patch(
            "app.main._resolve_stockfish_path_or_raise", return_value="stockfish"
        ), patch(
            "app.main.find_mate_in_1_to_3",
            return_value=mate_line,
        ), patch(
            "app.main.get_optional_local_auth_user_from_current_user",
            return_value=object(),
        ), patch(
            "app.main._persist_local_auth_submission",
            side_effect=RuntimeError("db write failed"),
        ), patch(
            "app.main.clear_failed_solve_attempts",
            new_callable=AsyncMock,
        ):
            response = await main.solve(
                request=req,
                current_user={"sub": "auth0|user"},
                upload=upload,
                _engine_guard=None,
                db=db,
            )

        self.assertEqual(response["moves_san"], ["Qh4#"])
        self.assertEqual(response["moves_uci"], ["d8h4"])
        self.assertTrue(response["mate_found"])
        self.assertEqual(response["solver_confidence"], 0.7562)
        self.assertEqual(response["solver_confidence_label"], "medium")

    async def test_solve_returns_best_engine_line_when_no_short_mate(self) -> None:
        from app import main

        req = _request(path="/solve")
        upload = protection_service.ValidatedSolveUpload(
            data=_png_bytes(),
            filename="board.png",
            content_type="image/png",
        )
        best_line = SimpleNamespace(
            mate_in=None,
            moves_san=["e4", "e5"],
            moves_uci=["e2e4", "e7e5"],
        )

        with patch(
            "app.main.fen_from_image_bytes",
            return_value={
                "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
                "confidence": 0.96,
                "attempts_used": 1,
                "raw_output": "{}",
            },
        ), patch(
            "app.main._resolve_stockfish_path_or_raise", return_value="stockfish"
        ), patch(
            "app.main.find_mate_in_1_to_3",
            return_value=None,
        ), patch(
            "app.main.find_best_engine_line",
            return_value=best_line,
        ), patch(
            "app.main.get_optional_local_auth_user_from_current_user",
            return_value=None,
        ), patch(
            "app.main.clear_failed_solve_attempts",
            new_callable=AsyncMock,
        ):
            response = await main.solve(
                request=req,
                current_user={"sub": "auth0|user"},
                upload=upload,
                _engine_guard=None,
                db=SimpleNamespace(),
            )

        self.assertFalse(response["mate_found"])
        self.assertIsNone(response["mate_in"])
        self.assertEqual(response["moves_san"], ["e4", "e5"])
        self.assertEqual(response["moves_uci"], ["e2e4", "e7e5"])
        self.assertEqual(response["solver_confidence"], 0.7087)
        self.assertEqual(response["solver_confidence_label"], "low")

    async def test_solve_rejects_unstable_mate_candidate(self) -> None:
        from app import main

        req = _request(path="/solve")
        upload = protection_service.ValidatedSolveUpload(
            data=_png_bytes(),
            filename="board.png",
            content_type="image/png",
        )
        consensus_fen = "6k1/5ppp/8/8/8/8/5PPP/6KQ b - - 0 1"
        mate_fen = "6k1/5ppp/8/8/8/8/5PPP/6KQ w - - 0 1"
        mate_line = SimpleNamespace(
            mate_in=1,
            moves_san=["Qh8#"],
            moves_uci=["h1h8"],
        )

        def _mate_for_candidate(*, fen: str, **_kwargs):
            return mate_line if fen == mate_fen else None

        with patch(
            "app.main.fen_from_image_bytes",
            return_value={
                "fen": consensus_fen,
                "confidence": 0.98,
                "side_to_move": "black",
                "attempts_used": 5,
                "raw_output": "{}",
                "candidates": [
                    {
                        "fen": consensus_fen,
                        "confidence": 0.98,
                        "side_to_move": "black",
                        "is_valid": True,
                        "side_matches_expected": True,
                        "vote_count": 1,
                    },
                    {
                        "fen": mate_fen,
                        "confidence": 0.91,
                        "side_to_move": "white",
                        "is_valid": True,
                        "side_matches_expected": True,
                        "vote_count": 1,
                    },
                ],
            },
        ), patch(
            "app.main._resolve_stockfish_path_or_raise", return_value="stockfish"
        ), patch(
            "app.main.find_mate_in_1_to_3",
            side_effect=_mate_for_candidate,
        ), patch(
            "app.main.find_best_engine_line",
            return_value=None,
        ), patch(
            "app.main.get_optional_local_auth_user_from_current_user",
            return_value=None,
        ), patch(
            "app.main.clear_failed_solve_attempts",
            new_callable=AsyncMock,
        ), patch(
            "app.main.record_failed_solve_attempt",
            new_callable=AsyncMock,
        ):
            with self.assertRaises(HTTPException) as exc:
                await main.solve(
                    request=req,
                    current_user={"sub": "auth0|user"},
                    upload=upload,
                    _engine_guard=None,
                    db=SimpleNamespace(),
                )

        self.assertEqual(exc.exception.status_code, 422)
        self.assertIn("Could not read the board reliably", exc.exception.detail)

    async def test_solve_prefers_stable_engine_verified_mate_candidate(self) -> None:
        from app import main

        req = _request(path="/solve")
        upload = protection_service.ValidatedSolveUpload(
            data=_png_bytes(),
            filename="board.png",
            content_type="image/png",
        )
        consensus_fen = "6k1/5ppp/8/8/8/8/5PPP/6KQ w - - 0 1"
        mate_fen = "6k1/5ppp/8/8/8/8/5PPQ/6K1 w - - 0 1"
        mate_line = SimpleNamespace(
            mate_in=1,
            moves_san=["Qh7#"],
            moves_uci=["h2h7"],
        )
        best_line = SimpleNamespace(
            mate_in=None,
            moves_san=["Qh4"],
            moves_uci=["h1h4"],
        )

        def _mate_for_candidate(*, fen: str, **_kwargs):
            return mate_line if fen == mate_fen else None

        with patch(
            "app.main.fen_from_image_bytes",
            return_value={
                "fen": consensus_fen,
                "confidence": 0.93,
                "side_to_move": "white",
                "attempts_used": 5,
                "raw_output": "{}",
                "candidates": [
                    {
                        "fen": consensus_fen,
                        "confidence": 0.93,
                        "side_to_move": "white",
                        "is_valid": True,
                        "side_matches_expected": True,
                        "vote_count": 3,
                    },
                    {
                        "fen": mate_fen,
                        "confidence": 0.9,
                        "side_to_move": "white",
                        "is_valid": True,
                        "side_matches_expected": True,
                        "vote_count": 2,
                    },
                ],
            },
        ), patch(
            "app.main._resolve_stockfish_path_or_raise", return_value="stockfish"
        ), patch(
            "app.main.find_mate_in_1_to_3",
            side_effect=_mate_for_candidate,
        ) as mock_mate, patch(
            "app.main.find_best_engine_line",
            return_value=best_line,
        ), patch(
            "app.main.get_optional_local_auth_user_from_current_user",
            return_value=None,
        ), patch(
            "app.main.clear_failed_solve_attempts",
            new_callable=AsyncMock,
        ):
            response = await main.solve(
                request=req,
                current_user={"sub": "auth0|user"},
                upload=upload,
                _engine_guard=None,
                db=SimpleNamespace(),
            )

        self.assertEqual(response["fen"], mate_fen)
        self.assertTrue(response["mate_found"])
        self.assertEqual(response["mate_in"], 1)
        self.assertEqual(response["moves_san"], ["Qh7#"])
        self.assertGreaterEqual(mock_mate.call_count, 2)


class GeminiHardeningTests(unittest.TestCase):
    def test_preprocess_variants_preserve_original_and_upscale_small_crop(self) -> None:
        with patch.dict(
            os.environ,
            {
                "GEMINI_IMAGE_MIN_DIMENSION": "1400",
                "GEMINI_IMAGE_MAX_DIMENSION": "2200",
            },
            clear=False,
        ):
            original = _png_bytes(width=320, height=240)
            variants = gemini_fen._preprocess_image_variants(original, "board.png")

        self.assertGreaterEqual(len(variants), 3)
        self.assertEqual(variants[0], (original, "image/png"))

        from PIL import Image

        preserved = Image.open(BytesIO(variants[1][0]))
        self.assertEqual(max(preserved.size), 1400)

    def test_preprocess_variants_bound_large_images_without_jpeg_loss(self) -> None:
        with patch.dict(
            os.environ,
            {
                "GEMINI_IMAGE_MIN_DIMENSION": "1400",
                "GEMINI_IMAGE_MAX_DIMENSION": "1600",
            },
            clear=False,
        ):
            variants = gemini_fen._preprocess_image_variants(
                _png_bytes(width=3000, height=2200),
                "board.png",
            )

        from PIL import Image

        preserved = Image.open(BytesIO(variants[1][0]))
        self.assertEqual(max(preserved.size), 1600)
        self.assertEqual(variants[1][1], "image/png")

    def test_attempt_hard_cap_limits_total_attempts(self) -> None:
        call_count = 0

        def _always_fail(*_args, **_kwargs):
            nonlocal call_count
            call_count += 1
            raise RuntimeError("boom")

        with patch.dict(
            os.environ,
            {
                "GOOGLE_API_KEY": "test-key",
                "GEMINI_TRANSCRIBE_ATTEMPTS": "99",
                "GEMINI_MAX_ATTEMPTS_HARD_CAP": "2",
            },
            clear=False,
        ):
            with patch("app.services.gemini_fen.genai.Client", return_value=object()):
                with patch(
                    "app.services.gemini_fen._preprocess_image_variants",
                    return_value=[(b"x", "image/png")],
                ):
                    with patch(
                        "app.services.gemini_fen._call_gemini_structured",
                        side_effect=_always_fail,
                    ):
                        with self.assertRaises(ValueError):
                            gemini_fen.fen_from_image_bytes(
                                b"dummy",
                                filename="board.png",
                                expected_side_to_move=None,
                                attempts=9,
                                include_raw_output=False,
                            )
        self.assertEqual(call_count, 2)

    def test_gemini_call_timeout_is_enforced(self) -> None:
        class _SlowModels:
            def generate_content(self, **_kwargs):
                time.sleep(1.2)
                return SimpleNamespace(text="{}")

        class _SlowClient:
            models = _SlowModels()

        with patch.dict(
            os.environ,
            {"GEMINI_REQUEST_TIMEOUT_SECONDS": "1"},
            clear=False,
        ):
            with self.assertRaises(TimeoutError):
                gemini_fen._call_gemini_structured(
                    _SlowClient(),
                    b"abc",
                    "image/png",
                    correction_message=None,
                )

    def test_expected_side_overrides_gemini_reported_side(self) -> None:
        board_map = {square: "." for square in gemini_fen.SQUARES}
        board_map.update({"g8": "k", "g1": "K", "h1": "Q"})

        with patch.dict(
            os.environ,
            {
                "GOOGLE_API_KEY": "test-key",
                "GEMINI_TRANSCRIBE_ATTEMPTS": "1",
                "GEMINI_MAX_ATTEMPTS_HARD_CAP": "1",
            },
            clear=False,
        ):
            with patch("app.services.gemini_fen.genai.Client", return_value=object()):
                with patch(
                    "app.services.gemini_fen._preprocess_image_variants",
                    return_value=[(b"x", "image/png")],
                ):
                    with patch(
                        "app.services.gemini_fen._call_gemini_structured",
                        return_value={
                            "side_to_move": "black",
                            "confidence": 0.9,
                            "board_map": board_map,
                            "_raw_output": "{}",
                        },
                    ):
                        result = gemini_fen.fen_from_image_bytes(
                            b"dummy",
                            filename="board.png",
                            expected_side_to_move="white",
                            attempts=1,
                            include_raw_output=True,
                        )

        self.assertEqual(result["fen"], "6k1/8/8/8/8/8/8/6KQ w - - 0 1")
        self.assertEqual(result["side_to_move"], "white")

    def test_include_candidates_returns_unique_valid_candidates(self) -> None:
        board_map = {square: "." for square in gemini_fen.SQUARES}
        board_map.update({"g8": "k", "g1": "K", "h1": "Q"})

        with patch.dict(
            os.environ,
            {
                "GOOGLE_API_KEY": "test-key",
                "GEMINI_TRANSCRIBE_ATTEMPTS": "1",
                "GEMINI_MAX_ATTEMPTS_HARD_CAP": "1",
            },
            clear=False,
        ):
            with patch("app.services.gemini_fen.genai.Client", return_value=object()):
                with patch(
                    "app.services.gemini_fen._preprocess_image_variants",
                    return_value=[(b"x", "image/png")],
                ):
                    with patch(
                        "app.services.gemini_fen._call_gemini_structured",
                        return_value={
                            "side_to_move": "white",
                            "confidence": 0.9,
                            "board_map": board_map,
                            "_raw_output": "{}",
                        },
                    ):
                        result = gemini_fen.fen_from_image_bytes(
                            b"dummy",
                            filename="board.png",
                            expected_side_to_move="white",
                            attempts=1,
                            include_candidates=True,
                        )

        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(result["candidates"][0]["fen"], result["fen"])
        self.assertEqual(result["candidates"][0]["vote_count"], 1)
        self.assertEqual(result["consensus_votes"], 1)
        self.assertEqual(result["unique_fen_count"], 1)


if __name__ == "__main__":
    unittest.main()
