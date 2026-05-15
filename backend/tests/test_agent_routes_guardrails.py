from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.errors import install_api_error_handlers
from app.db_auth import get_db
from app.models_auth import LocalAuthUser
from app.routes.agent import router
from app.services.agent_chat import FALLBACK_ANSWER, GeminiServiceError


class AgentRoutesGuardrailsTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        install_api_error_handlers(app)
        app.include_router(router, prefix="/agent")
        self.fake_db = SimpleNamespace(get=lambda *_args, **_kwargs: None)

        def _override_get_db():
            yield self.fake_db

        app.dependency_overrides[get_db] = _override_get_db
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_chat_rejects_empty_query_with_400(self) -> None:
        response = self.client.post("/agent/chat", json={"query": "   "})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_query")

    def test_chat_rejects_too_long_query_with_400(self) -> None:
        response = self.client.post("/agent/chat", json={"query": "a" * 1001})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_query")

    @patch("app.routes.agent.generate_rag_answer")
    def test_chat_returns_structured_gemini_error(
        self, mock_generate_rag_answer
    ) -> None:
        mock_generate_rag_answer.side_effect = GeminiServiceError(
            "Gemini API request failed."
        )
        response = self.client.post("/agent/chat", json={"query": "settings?"})
        self.assertEqual(response.status_code, 502)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "gemini_api_error")
        self.assertEqual(payload["error"]["message"], "Gemini API request failed.")

    @patch("app.routes.agent.generate_rag_answer")
    def test_chat_passes_through_fallback_response(
        self, mock_generate_rag_answer
    ) -> None:
        mock_generate_rag_answer.return_value = {"answer": FALLBACK_ANSWER}
        response = self.client.post("/agent/chat", json={"query": "missing topic"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["answer"], FALLBACK_ANSWER)
        self.assertNotIn("sources", payload)

    @patch("app.routes.agent.build_submission_history_context_for_user")
    @patch("app.routes.agent.generate_rag_answer")
    def test_chat_passes_sanitized_user_profile_context(
        self,
        mock_generate_rag_answer,
        mock_build_history,
    ) -> None:
        user_id = uuid4()
        local_auth_user = LocalAuthUser(
            id=user_id,
            username="player-one",
            email="player@example.com",
            password_hash="do-not-expose",
        )
        self.fake_db.get = lambda *_args, **_kwargs: local_auth_user
        mock_build_history.return_value = []
        mock_generate_rag_answer.return_value = {"answer": "ok"}

        response = self.client.post(
            "/agent/chat",
            json={
                "query": "What is my profile data?",
                "conversation_mode": "grandmaster",
            },
            headers={"X-Local-Auth-User-Id": str(user_id)},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            mock_generate_rag_answer.call_args.kwargs["conversation_mode"],
            "grandmaster",
        )
        profile_context = mock_generate_rag_answer.call_args.kwargs[
            "user_profile_context"
        ]
        self.assertEqual(
            profile_context["local_profile"]["username"],
            "player-one",
        )
        self.assertEqual(
            profile_context["local_profile"]["email"],
            "player@example.com",
        )
        self.assertNotIn("password_hash", profile_context["local_profile"])


if __name__ == "__main__":
    unittest.main()
