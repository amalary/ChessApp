import base64
import json
import os
from collections import Counter
from io import BytesIO
from typing import Any, Dict, Iterable

from google import genai
from PIL import Image, ImageEnhance, ImageOps

DEFAULT_MODEL_CANDIDATES = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-1.5-flash",
    "gemini-2.0-flash",
    "gemini-3-flash-preview",
]

FILES = "abcdefgh"
RANKS = "87654321"
SQUARES = [f"{file}{rank}" for rank in RANKS for file in FILES]
PIECES = {"K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p", "."}

SYSTEM_PROMPT = """
You are a chessboard transcriber. You do NOT solve chess.
Given one chessboard image, return ONLY JSON with this exact schema:
{
  "side_to_move": "white" | "black",
  "confidence": 0.0,
  "board_map": {
    "a8": ".", "b8": ".", ..., "h1": "."
  }
}

Rules:
- board_map must contain all 64 squares from a8 to h1.
- Use exactly one symbol per square:
  K,Q,R,B,N,P for white pieces
  k,q,r,b,n,p for black pieces
  . for empty
- Do not include explanations, markdown, SAN, or best move.
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


def _preprocess_image_variants(image_bytes: bytes, filename: str | None) -> list[tuple[bytes, str]]:
    variants: list[tuple[bytes, str]] = [(image_bytes, _guess_mime(filename))]
    try:
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        normalized = ImageOps.autocontrast(img, cutoff=1)
        normalized = ImageEnhance.Sharpness(normalized).enhance(1.25)
        normalized = ImageEnhance.Contrast(normalized).enhance(1.15)

        out = BytesIO()
        normalized.save(out, format="PNG")
        variants.append((out.getvalue(), "image/png"))
    except Exception:
        pass
    return variants


def _strip_code_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines:
            lines = lines[1:]
        while lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _extract_json_text(text: str) -> str:
    candidate = _strip_code_fence(text)
    if candidate.startswith("{") and candidate.endswith("}"):
        return candidate
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start != -1 and end != -1 and end > start:
        return candidate[start : end + 1]
    return candidate


def _model_candidates() -> list[str]:
    explicit = os.getenv("GEMINI_MODEL")
    if explicit:
        return [explicit] + [m for m in DEFAULT_MODEL_CANDIDATES if m != explicit]
    return DEFAULT_MODEL_CANDIDATES


def _normalize_side(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"w", "white"}:
        return "w"
    if text in {"b", "black"}:
        return "b"
    return None


def _normalize_piece_token(value: Any) -> str | None:
    if value is None:
        return "."
    text = str(value).strip()
    if text in PIECES:
        return text

    lowered = text.lower().replace("-", "").replace("_", "").replace(" ", "")
    if lowered in {"", ".", "empty", "none", "null"}:
        return "."
    if lowered in {"wk", "whiteking"}:
        return "K"
    if lowered in {"wq", "whitequeen"}:
        return "Q"
    if lowered in {"wr", "whiterook"}:
        return "R"
    if lowered in {"wb", "whitebishop"}:
        return "B"
    if lowered in {"wn", "whiteknight"}:
        return "N"
    if lowered in {"wp", "whitepawn"}:
        return "P"
    if lowered in {"bk", "blackking"}:
        return "k"
    if lowered in {"bq", "blackqueen"}:
        return "q"
    if lowered in {"br", "blackrook"}:
        return "r"
    if lowered in {"bb", "blackbishop"}:
        return "b"
    if lowered in {"bn", "blackknight"}:
        return "n"
    if lowered in {"bp", "blackpawn"}:
        return "p"
    return None


def _extract_board_map(data: dict[str, Any]) -> dict[str, str] | None:
    board_map = data.get("board_map")
    if not isinstance(board_map, dict):
        board_map = data.get("squares")
    if not isinstance(board_map, dict):
        return None

    normalized: dict[str, str] = {}
    for square in SQUARES:
        raw = board_map.get(square)
        piece = _normalize_piece_token(raw)
        if piece is None:
            return None
        normalized[square] = piece

    if set(normalized) != set(SQUARES):
        return None
    return normalized


def _board_map_to_fen(board_map: dict[str, str], side_to_move: str) -> str:
    rows: list[str] = []
    for rank in RANKS:
        empty = 0
        row = ""
        for file in FILES:
            piece = board_map[f"{file}{rank}"]
            if piece == ".":
                empty += 1
            else:
                if empty:
                    row += str(empty)
                    empty = 0
                row += piece
        if empty:
            row += str(empty)
        rows.append(row)
    return f"{'/'.join(rows)} {side_to_move} - - 0 1"


def _call_gemini_structured(
    client: genai.Client,
    image_bytes: bytes,
    mime: str,
    correction_message: str | None = None,
) -> dict[str, Any]:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    user_parts: list[dict[str, Any]] = [
        {
            "inline_data": {
                "mime_type": mime,
                "data": b64,
            }
        }
    ]
    if correction_message:
        user_parts.append({"text": correction_message})

    resp = None
    last_model_error: Exception | None = None
    for model_name in _model_candidates():
        try:
            resp = client.models.generate_content(
                model=model_name,
                contents=[{"role": "user", "parts": user_parts}],
                config={
                    "system_instruction": SYSTEM_PROMPT,
                    "response_mime_type": "application/json",
                    "temperature": 0,
                },
            )
            break
        except Exception as exc:
            message = str(exc)
            if "NOT_FOUND" in message or "no longer available" in message.lower():
                last_model_error = exc
                continue
            raise

    if resp is None:
        if last_model_error is not None:
            raise last_model_error
        raise RuntimeError("Gemini failed to return a response")

    text = (resp.text or "").strip()
    json_text = _extract_json_text(text)
    return json.loads(json_text)


def _pick_consensus_fen(candidates: Iterable[dict[str, Any]]) -> dict[str, Any]:
    rows = list(candidates)
    if not rows:
        raise ValueError("Gemini could not produce a valid board transcription.")

    counts = Counter(item["fen"] for item in rows)
    best_fen, _ = counts.most_common(1)[0]
    fen_rows = [item for item in rows if item["fen"] == best_fen]
    avg_conf = sum(item["confidence"] for item in fen_rows) / len(fen_rows)
    return {
        "fen": best_fen,
        "confidence": round(avg_conf, 4),
        "side_to_move": "white" if fen_rows[0]["side"] == "w" else "black",
        "attempts_used": len(rows),
    }


def fen_from_image_bytes(
    image_bytes: bytes,
    filename: str | None = None,
    expected_side_to_move: str | None = None,
    attempts: int = 2,
) -> Dict[str, Any]:
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError(
            "Missing Gemini API key. Set GOOGLE_API_KEY (or GEMINI_API_KEY)."
        )
    client = genai.Client(api_key=api_key)
    expected = _normalize_side(expected_side_to_move)
    variants = _preprocess_image_variants(image_bytes, filename)

    valid_candidates: list[dict[str, Any]] = []
    correction_message: str | None = None
    last_error = "No response from Gemini."
    early_exit_confidence = 0.9
    env_early_exit_confidence = os.getenv("GEMINI_EARLY_EXIT_CONFIDENCE")
    if env_early_exit_confidence:
        try:
            early_exit_confidence = float(env_early_exit_confidence)
        except ValueError:
            pass

    env_attempts = os.getenv("GEMINI_TRANSCRIBE_ATTEMPTS")
    if env_attempts:
        try:
            attempts = int(env_attempts)
        except ValueError:
            pass

    max_attempts = max(1, attempts)
    for idx in range(max_attempts):
        payload, mime = variants[idx % len(variants)]
        try:
            data = _call_gemini_structured(client, payload, mime, correction_message)
            board_map = _extract_board_map(data)
            side = _normalize_side(data.get("side_to_move"))
            if board_map is None or side is None:
                last_error = "Gemini response missing valid board_map/side_to_move."
                correction_message = (
                    "Previous output was invalid. Return all 64 squares in board_map and "
                    "a valid side_to_move ('white' or 'black')."
                )
                continue

            if expected and side != expected:
                last_error = (
                    f"Gemini returned side_to_move={side}, expected {expected}."
                )
                correction_message = (
                    f"Use side_to_move='{ 'white' if expected == 'w' else 'black' }'. "
                    "Re-evaluate board_map carefully."
                )
                continue

            fen = _board_map_to_fen(board_map, side)
            confidence_raw = data.get("confidence", 0.0)
            try:
                confidence = float(confidence_raw)
            except (TypeError, ValueError):
                confidence = 0.0

            valid_candidates.append(
                {
                    "fen": fen,
                    "confidence": max(0.0, min(1.0, confidence)),
                    "side": side,
                }
            )
            # Fast path: return immediately when the first valid transcription is high confidence.
            if confidence >= early_exit_confidence:
                return {
                    "fen": fen,
                    "confidence": max(0.0, min(1.0, confidence)),
                    "side_to_move": "white" if side == "w" else "black",
                    "attempts_used": idx + 1,
                }
            correction_message = (
                "Double-check every occupied square and ensure board_map is exact."
            )
        except Exception as exc:
            last_error = str(exc)
            correction_message = (
                f"Previous output could not be parsed ({last_error}). "
                "Return strict JSON only."
            )

    if not valid_candidates:
        raise ValueError(f"Gemini could not transcribe board: {last_error}")
    return _pick_consensus_fen(valid_candidates)
