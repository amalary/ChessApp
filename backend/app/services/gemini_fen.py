import base64
import json
import os
from io import BytesIO
from typing import Any, Dict, Iterable

from google import genai
from PIL import Image, ImageEnhance, ImageOps

from app.services.board_validation import validate_fen

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


def _preprocess_image_variants(
    image_bytes: bytes, filename: str | None
) -> list[tuple[bytes, str]]:
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


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


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


def _pick_consensus_fen(
    candidates: Iterable[dict[str, Any]],
    expected_side: str | None = None,
    attempts_used: int | None = None,
) -> dict[str, Any]:
    rows = list(candidates)
    if not rows:
        raise ValueError("Gemini could not produce a valid board transcription.")

    groups: dict[str, list[dict[str, Any]]] = {}
    for item in rows:
        groups.setdefault(item["fen"], []).append(item)

    best_fen = ""
    best_score = float("-inf")
    best_rows: list[dict[str, Any]] = []
    for fen, fen_rows in groups.items():
        vote_count = len(fen_rows)
        avg_conf = sum(item["confidence"] for item in fen_rows) / vote_count
        valid_count = sum(1 for item in fen_rows if bool(item.get("is_valid")))
        side = fen_rows[0]["side"]
        score = (vote_count * 2.0) + avg_conf + (valid_count / vote_count)
        if expected_side and side == expected_side:
            score += 0.2
        if score > best_score:
            best_score = score
            best_fen = fen
            best_rows = fen_rows

    avg_conf = sum(item["confidence"] for item in best_rows) / len(best_rows)
    return {
        "fen": best_fen,
        "confidence": round(avg_conf, 4),
        "side_to_move": "white" if best_rows[0]["side"] == "w" else "black",
        "attempts_used": attempts_used if attempts_used is not None else len(rows),
    }


def fen_from_image_bytes(
    image_bytes: bytes,
    filename: str | None = None,
    expected_side_to_move: str | None = None,
    attempts: int = 3,
) -> Dict[str, Any]:
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError(
            "Missing Gemini API key. Set GOOGLE_API_KEY (or GEMINI_API_KEY)."
        )
    client = genai.Client(api_key=api_key)
    expected = _normalize_side(expected_side_to_move)
    variants = _preprocess_image_variants(image_bytes, filename)

    all_candidates: list[dict[str, Any]] = []
    valid_candidates: list[dict[str, Any]] = []
    correction_message: str | None = None
    last_error = "No response from Gemini."
    early_exit_confidence = max(
        0.0, min(1.0, _env_float("GEMINI_EARLY_EXIT_CONFIDENCE", 0.92))
    )
    min_attempts = max(1, _env_int("GEMINI_MIN_ATTEMPTS", 3))
    max_attempts = max(1, _env_int("GEMINI_TRANSCRIBE_ATTEMPTS", attempts))
    consensus_exit_votes = max(2, _env_int("GEMINI_CONSENSUS_EXIT_VOTES", 3))

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

            side_matches_expected = (expected is None) or (side == expected)
            if expected and not side_matches_expected:
                last_error = (
                    f"Gemini returned side_to_move={side}, expected {expected}."
                )
                correction_message = (
                    f"Use side_to_move='{ 'white' if expected == 'w' else 'black' }'. "
                    "Re-evaluate board_map carefully, but still return your best board_map."
                )

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
                    "is_valid": validate_fen(fen).passed,
                    "side_matches_expected": side_matches_expected,
                }
            )
            all_candidates.extend(valid_candidates[-1:])

            if not valid_candidates[-1]["is_valid"]:
                last_error = "Gemini produced an implausible board position."
                correction_message = (
                    "Previous board_map produced an invalid chess position. "
                    "Re-check king count, pawn ranks, and side to move."
                )
                continue

            # Fast path: once we have enough attempts and repeated agreement at high confidence.
            fen_count = sum(1 for item in valid_candidates if item["fen"] == fen)
            fen_avg_conf = sum(
                item["confidence"] for item in valid_candidates if item["fen"] == fen
            ) / max(1, fen_count)
            if (
                (idx + 1) >= min_attempts
                and fen_count >= consensus_exit_votes
                and fen_avg_conf >= early_exit_confidence
                and side_matches_expected
            ):
                return {
                    "fen": fen,
                    "confidence": round(fen_avg_conf, 4),
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

    valid_only = [row for row in valid_candidates if bool(row.get("is_valid"))]
    if valid_only:
        return _pick_consensus_fen(
            valid_only,
            expected_side=expected,
            attempts_used=max_attempts,
        )
    return _pick_consensus_fen(
        all_candidates if all_candidates else valid_candidates,
        expected_side=expected,
        attempts_used=max_attempts,
    )
