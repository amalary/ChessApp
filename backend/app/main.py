import os
import shutil
from pathlib import Path

import chess
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health
from app.services.board_validate import board_map_to_fen, rotate_board_map_180
from app.services.board_validation import validate_fen
from app.services.gemini_fen import fen_from_image_bytes
from app.services.mate_solver import find_mate_in_1_to_3


def _load_env_file(path: Path) -> None:
    if not path.exists() or not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def _bootstrap_env() -> None:
    here = Path(__file__).resolve()
    candidates = [Path.cwd() / ".env", here.parents[2] / ".env"]
    for parent in here.parents:
        candidates.append(parent / "ChessApp" / ".env")
    for env_path in candidates:
        _load_env_file(env_path)

    if "GOOGLE_API_KEY" not in os.environ and "GEMINI_API_KEY" in os.environ:
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]


_bootstrap_env()


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _normalize_side(side: str | None) -> str | None:
    if not side:
        return None
    lowered = side.strip().lower()
    if lowered in {"white", "w"}:
        return "white"
    if lowered in {"black", "b"}:
        return "black"
    return None


def _board_map_from_fen(fen: str) -> dict[str, str]:
    board = chess.Board(fen)
    board_map = {chess.square_name(sq): "." for sq in chess.SQUARES}
    for sq, piece in board.piece_map().items():
        board_map[chess.square_name(sq)] = piece.symbol()
    return board_map


def _build_fallback_fens(fen: str, expected_side: str | None) -> list[str]:
    board = chess.Board(fen)
    board_map = _board_map_from_fen(fen)
    rotated_map = rotate_board_map_180(board_map)

    current_side = "white" if board.turn else "black"
    sides = [current_side]
    if expected_side in {"white", "black"} and expected_side not in sides:
        sides.insert(0, expected_side)

    ordered: list[str] = []
    for side in sides:
        ordered.append(board_map_to_fen(board_map, side))
        ordered.append(board_map_to_fen(rotated_map, side))

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in ordered:
        if candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def _candidate_score(
    candidate_fen: str,
    mate_result,
    preferred_fen: str,
    expected_side: str | None,
) -> float:
    score = 0.0
    if mate_result is not None:
        score += 2.0
        score += max(0.0, 0.55 - (mate_result.mate_in * 0.12))
    if candidate_fen == preferred_fen:
        score += 0.2
    if expected_side in {"white", "black"}:
        try:
            side = "white" if chess.Board(candidate_fen).turn else "black"
            if side == expected_side:
                score += 0.25
        except Exception:
            pass
    return score

app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Existing health router
app.include_router(health.router)


@app.get("/")
async def root():
    return {"message": "Backend is running"}


# Temporarily open for testing without Auth0
@app.post("/solve")
async def solve(
    image: UploadFile = File(...),
    expected_side_to_move: str | None = Form(None),
):
    try:
        image_bytes = await image.read()

        if not image_bytes:
            raise HTTPException(status_code=400, detail="No image uploaded")

        # 1) Gemini Vision -> FEN
        gemini_result = fen_from_image_bytes(
            image_bytes,
            image.filename,
            expected_side_to_move=expected_side_to_move,
            attempts=max(1, _env_int("GEMINI_TRANSCRIBE_ATTEMPTS", 5)),
        )
        fen = gemini_result["fen"]
        confidence = gemini_result["confidence"]

        # 2) Validate FEN
        try:
            board = chess.Board(fen)
        except Exception:
            raise HTTPException(status_code=422, detail="Invalid FEN returned from Gemini")

        if not board.is_valid():
            raise HTTPException(status_code=422, detail="Invalid chess position detected")

        # 3) Run Stockfish
        stockfish_path = (
            os.environ.get("STOCKFISH_PATH")
            or shutil.which("stockfish")
            or "/usr/games/stockfish"
        )
        if not Path(stockfish_path).exists() and shutil.which("stockfish") is None:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Stockfish not found. Install Stockfish locally and set STOCKFISH_PATH "
                    "to the executable path."
                ),
            )

        result = find_mate_in_1_to_3(
            fen=fen,
            stockfish_path=stockfish_path,
        )

        expected_side = _normalize_side(expected_side_to_move)
        fallback_confidence_threshold = max(
            0.0, min(1.0, _env_float("SOLVE_FALLBACK_CONFIDENCE", 0.90))
        )
        should_run_fallback = (result is None) or (float(confidence) < fallback_confidence_threshold)

        if should_run_fallback:
            fallback_fens = _build_fallback_fens(fen, expected_side)
            fallback_think_time_s = max(0.6, _env_float("SOLVE_FALLBACK_THINK_TIME_S", 2.5))
            fallback_max_depth = max(10, _env_int("SOLVE_FALLBACK_MAX_DEPTH", 24))

            best_fen = fen
            best_result = result
            best_score = _candidate_score(
                candidate_fen=fen,
                mate_result=result,
                preferred_fen=fen,
                expected_side=expected_side,
            )

            for candidate_fen in fallback_fens:
                if candidate_fen == fen:
                    continue
                if not validate_fen(candidate_fen).passed:
                    continue

                candidate_result = find_mate_in_1_to_3(
                    fen=candidate_fen,
                    stockfish_path=stockfish_path,
                    think_time_s=fallback_think_time_s,
                    max_depth=fallback_max_depth,
                )
                score = _candidate_score(
                    candidate_fen=candidate_fen,
                    mate_result=candidate_result,
                    preferred_fen=fen,
                    expected_side=expected_side,
                )
                if score > best_score:
                    best_score = score
                    best_fen = candidate_fen
                    best_result = candidate_result

            fen = best_fen
            result = best_result
            gemini_result["side_to_move"] = "white" if chess.Board(fen).turn else "black"

        # 4) Response
        return {
            "fen": fen,
            "vision_confidence": confidence,
            "vision_side_to_move": gemini_result.get("side_to_move"),
            "vision_attempts_used": gemini_result.get("attempts_used"),
            "mate_found": result is not None,
            "mate_in": result.mate_in if result else None,
            "moves_san": result.moves_san if result else [],
            "moves_uci": result.moves_uci if result else [],
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
