import base64
import json
from typing import Any, Dict, Tuple

from google import genai 


GEMINI_MODEL = "gemini-2.0-flash"

SYSTEM_PROMPT = """
You are a chess position transcriber.
Given an image of a chessboard, output ONLY valid JSON.

Rules:
- Identify piece placement and side to move.
- Output a FEN string (6 fields): "pieces side castling enpassant halfmove fullmove"
- If castling rights/en-passant are unknown, set castling to "-" and en-passant to "-".
- halfmove = 0, fullmove = 1.
- Return this JSON schema EXACTLY:
{
  "fen": "<FEN>",
  "confidence": 0.0-1.0
}
No extra keys. No markdown. No commentary.
"""


def _guess_mime(filename: str | None) -> str:
    if not filename:
        return "image/png"
    lower = filename.lower()
    if lower.endswith(".jpg") or lower.endswith(".jpeg"):
        return "image/jpeg"
    if lower.endswith(".webp"):
        return "image/webp"
    return "image/png"


def fen_from_image_bytes(image_bytes: bytes, filename: str | None = None) -> Dict[str, Any]:
    # Uses GOOGLE_API_KEY from env by default
    client = genai.Client()

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    mime = _guess_mime(filename)

    resp = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            {"role": "system", "parts": [{"text": SYSTEM_PROMPT}]},
            {
                "role": "user",
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": mime,
                            "data": b64,
                        }
                    }
                ],
            },
        ],
    )

    text = (resp.text or "").strip()
    data = json.loads(text)

    if not isinstance(data, dict) or "fen" not in data or "confidence" not in data:
        raise ValueError(f"Gemini returned unexpected JSON: {text}")

    return data 