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

from app.services import gemini_fen, protection_service


def _request(path: str = "/solve", *, remote_ip: str = "127.0.0.1", xff: str | None = None):
    headers: list[tuple[bytes, bytes]] = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode("utf-8")))
    app = SimpleNamespace(
        state=SimpleNamespace(redis_client=SimpleNamespace(ttl=AsyncMock(return_value=-2)))
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

    @patch("app.services.protection_service.record_failed_solve_attempt", new_callable=AsyncMock)
    async def test_validate_upload_rejects_content_type_mismatch(self, _mock_record_failed: AsyncMock) -> None:
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

        with patch("app.services.protection_service._enforce_fixed_window_rule", side_effect=_fake_enforce):
            response = await protection_service.enforce_global_limits(req, redis_client)

        self.assertIsNone(response)
        self.assertIn("solve_ip_rate_limit", seen_reasons)

    async def test_solve_returns_solution_when_submission_persistence_fails(self) -> None:
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
        ), patch("app.main._resolve_stockfish_path_or_raise", return_value="stockfish"), patch(
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


class GeminiHardeningTests(unittest.TestCase):
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
                with patch("app.services.gemini_fen._preprocess_image_variants", return_value=[(b"x", "image/png")]):
                    with patch("app.services.gemini_fen._call_gemini_structured", side_effect=_always_fail):
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


if __name__ == "__main__":
    unittest.main()
