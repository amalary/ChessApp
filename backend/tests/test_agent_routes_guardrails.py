from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.errors import install_api_error_handlers
from app.routes.agent import router
from app.services.agent_chat import FALLBACK_ANSWER, GeminiServiceError


class AgentRoutesGuardrailsTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        install_api_error_handlers(app)
        app.include_router(router, prefix="/agent")
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


if __name__ == "__main__":
    unittest.main()
