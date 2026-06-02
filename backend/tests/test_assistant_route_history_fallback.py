from __future__ import annotations

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth0 import get_optional_current_user
from app.db_auth import get_db
from app.local_auth_session import issue_local_auth_session_token
from app.models_auth import LocalAuthUser
from app.routers.assistant import router


class AssistantRouteHistoryFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ.setdefault("LOCAL_AUTH_SESSION_SECRET", "test-local-auth-session-secret")
        app = FastAPI()
        app.include_router(router)
        self.fake_db = SimpleNamespace(get=lambda *_args, **_kwargs: None)

        def _override_get_db():
            yield self.fake_db

        app.dependency_overrides[get_db] = _override_get_db
        app.dependency_overrides[get_optional_current_user] = lambda: {"sub": "auth0|test-user"}
        self.client = TestClient(app, raise_server_exceptions=False)

    @patch("app.routers.assistant.assistant_agent.run")
    def test_assistant_uses_client_history_without_local_auth_header(
        self,
        mock_run,
    ) -> None:
        mock_run.return_value = {
            "response_text": "ok",
            "theme_tags": [],
            "confidence": 0.9,
            "referenced_move": None,
            "guardrail_triggered": False,
            "guardrail_reason": None,
        }

        response = self.client.post(
            "/assistant",
            json={
                "user_message": "Explain my latest solved puzzle",
                "requested_mode": "followup",
                "client_puzzle_history": [
                    {
                        "id": "submission-1",
                        "fileName": "recent.png",
                        "submittedAt": "2026-05-20T12:00:00Z",
                        "fen": "8/8/8/8/8/8/8/K6k w - - 0 1",
                        "solutionLines": ["Kb2"],
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        passed_history = mock_run.call_args.kwargs["user_puzzle_history"]
        self.assertIsInstance(passed_history, list)
        self.assertEqual(len(passed_history), 1)
        self.assertEqual(passed_history[0]["fileName"], "recent.png")
        self.assertFalse(passed_history[0]["hasPuzzleImage"])

    @patch("app.routers.assistant.build_submission_history_context_for_user")
    @patch("app.routers.assistant.assistant_agent.run")
    def test_assistant_merges_client_and_server_history(
        self,
        mock_run,
        mock_build_history,
    ) -> None:
        user_id = uuid4()
        local_auth_user = LocalAuthUser(
            id=user_id,
            username="player-one",
            email="player@example.com",
            password_hash="hash",
        )
        self.fake_db.get = lambda *_args, **_kwargs: local_auth_user
        mock_build_history.return_value = [
            {
                "id": "server-older",
                "fileName": "older.png",
                "submittedAt": "2026-05-19T12:00:00Z",
                "fen": "8/8/8/8/8/8/8/K6k w - - 0 1",
                "solutionLines": ["Kb2"],
            }
        ]
        mock_run.return_value = {
            "response_text": "ok",
            "theme_tags": [],
            "confidence": 0.9,
            "referenced_move": None,
            "guardrail_triggered": False,
            "guardrail_reason": None,
        }

        response = self.client.post(
            "/assistant",
            headers={
                "X-Local-Auth-User-Id": str(user_id),
                "X-Local-Auth-Session": issue_local_auth_session_token(user_id),
            },
            json={
                "user_message": "Explain my latest solved puzzle",
                "requested_mode": "followup",
                "client_puzzle_history": [
                    {
                        "id": "client-newer",
                        "fileName": "newer.png",
                        "submittedAt": "2026-05-20T12:00:00Z",
                        "fen": "8/8/8/8/8/8/8/K6k w - - 0 1",
                        "solutionLines": ["Kb2"],
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        passed_history = mock_run.call_args.kwargs["user_puzzle_history"]
        self.assertEqual(len(passed_history), 2)
        self.assertEqual(passed_history[0]["id"], "client-newer")
        self.assertEqual(passed_history[1]["id"], "server-older")
        self.assertIn("hasPuzzleImage", passed_history[0])


if __name__ == "__main__":
    unittest.main()
