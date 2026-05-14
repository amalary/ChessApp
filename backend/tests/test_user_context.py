from __future__ import annotations

import unittest
from uuid import uuid4

from app.models_auth import LocalAuthUser
from app.services.user_context import (
    build_agent_user_profile_context,
    sanitize_user_context,
)


class UserContextTests(unittest.TestCase):
    def test_sanitize_user_context_strips_private_keys_recursively(self) -> None:
        payload = {
            "username": "alice",
            "password": "hidden",
            "nested": {
                "token": "secret",
                "api_key": "xyz",
                "safe_value": 3,
            },
        }
        cleaned = sanitize_user_context(payload)
        self.assertEqual(cleaned["username"], "alice")
        self.assertEqual(cleaned["nested"]["safe_value"], 3)
        self.assertNotIn("password", cleaned)
        self.assertNotIn("token", cleaned["nested"])
        self.assertNotIn("api_key", cleaned["nested"])

    def test_build_agent_user_profile_context_excludes_password_hash(self) -> None:
        user = LocalAuthUser(
            id=uuid4(),
            username="alice",
            email="alice@example.com",
            password_hash="never-show",
        )
        context = build_agent_user_profile_context(local_auth_user=user)
        self.assertIsNotNone(context)
        local_profile = context["local_profile"]
        self.assertEqual(local_profile["username"], "alice")
        self.assertEqual(local_profile["email"], "alice@example.com")
        self.assertNotIn("password_hash", local_profile)


if __name__ == "__main__":
    unittest.main()
