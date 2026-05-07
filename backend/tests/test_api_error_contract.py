from __future__ import annotations

import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.errors import install_api_error_handlers


class ApiErrorContractTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        install_api_error_handlers(app)

        @app.get("/http-string")
        def http_string_error() -> None:
            raise HTTPException(status_code=401, detail="Missing bearer token.")

        @app.get("/http-dict")
        def http_dict_error() -> None:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "forbidden_action",
                    "message": "Action is not allowed.",
                    "details": {"resource": "puzzle"},
                },
            )

        @app.get("/validation")
        def validation_error(limit: int) -> dict[str, int]:
            return {"limit": limit}

        @app.get("/unhandled")
        def unhandled_error() -> None:
            raise RuntimeError("unexpected")

        self.client = TestClient(app, raise_server_exceptions=False)

    def test_http_exception_string_detail_has_uniform_shape(self) -> None:
        response = self.client.get("/http-string")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(
            response.json(),
            {
                "error": {
                    "code": "http_error",
                    "message": "Missing bearer token.",
                }
            },
        )

    def test_http_exception_dict_detail_uses_explicit_code(self) -> None:
        response = self.client.get("/http-dict")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json(),
            {
                "error": {
                    "code": "forbidden_action",
                    "message": "Action is not allowed.",
                    "details": {"resource": "puzzle"},
                }
            },
        )

    def test_request_validation_error_uses_standard_code(self) -> None:
        response = self.client.get("/validation", params={"limit": "bad-int"})
        self.assertEqual(response.status_code, 422)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "request_validation_failed")
        self.assertEqual(payload["error"]["message"], "Request validation failed.")
        self.assertIsInstance(payload["error"].get("details"), list)

    def test_unhandled_error_uses_internal_server_code(self) -> None:
        response = self.client.get("/unhandled")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json(),
            {
                "error": {
                    "code": "internal_server_error",
                    "message": "Internal server error.",
                }
            },
        )


if __name__ == "__main__":
    unittest.main()

