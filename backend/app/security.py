from __future__ import annotations

import hashlib
import hmac
import secrets

PBKDF2_ALGORITHM = "sha256"
PBKDF2_ITERATIONS = 210_000
SALT_BYTES = 16


def hash_password(password: str) -> str:
    salt = secrets.token_hex(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_{PBKDF2_ALGORITHM}${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, encoded_password: str) -> bool:
    try:
        scheme, iterations_text, salt, digest_hex = encoded_password.split("$", 3)
        if not scheme.startswith("pbkdf2_"):
            return False
        algorithm = scheme.replace("pbkdf2_", "", 1)
        iterations = int(iterations_text)
    except (ValueError, TypeError):
        return False

    calculated = hashlib.pbkdf2_hmac(
        algorithm,
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    ).hex()
    return hmac.compare_digest(calculated, digest_hex)
