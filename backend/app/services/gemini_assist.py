from __future__ import annotations

import base64
import json
import os
from typing import Any, Dict

from google import genai


HINT_PROMPT = """
Extract puzzle text hints from the image.
Return ONLY JSON:
{
  "side_to_move": "white" | "black" | "unknown",
  "mate_in": 1 | 2 | 3 | null,
  "confidence": 0.0
}
No extra text.
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


def _json_or_default(text: str) -> dict[str, Any]:
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {"side_to_move": "unknown", "mate_in": None, "confidence": 0.0}


def extract_puzzle_hints(image_bytes: bytes, filename: str | None = None) -> Dict[str, Any]:
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"side_to_move": "unknown", "mate_in": None, "confidence": 0.0, "used": False}

    client = genai.Client(api_key=api_key)
    mime = _guess_mime(filename)
    b64 = base64.b64encode(image_bytes).decode("utf-8")

    try:
        resp = client.models.generate_content(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            contents=[
                {
                    "role": "user",
                    "parts": [
                        {"inline_data": {"mime_type": mime, "data": b64}},
                    ],
                }
            ],
            config={
                "system_instruction": HINT_PROMPT,
                "response_mime_type": "application/json",
                "temperature": 0,
            },
        )
        data = _json_or_default((resp.text or "").strip())
        side = str(data.get("side_to_move", "unknown")).strip().lower()
        if side not in {"white", "black", "unknown"}:
            side = "unknown"
        mate_in = data.get("mate_in")
        if isinstance(mate_in, int) and mate_in not in {1, 2, 3}:
            mate_in = None
        confidence = data.get("confidence", 0.0)
        try:
            confidence = max(0.0, min(1.0, float(confidence)))
        except Exception:
            confidence = 0.0
        return {
            "side_to_move": side,
            "mate_in": mate_in if isinstance(mate_in, int) else None,
            "confidence": confidence,
            "used": True,
        }
    except Exception:
        return {"side_to_move": "unknown", "mate_in": None, "confidence": 0.0, "used": False}

