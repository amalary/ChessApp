import os
import shutil
from pathlib import Path

import chess
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health
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
