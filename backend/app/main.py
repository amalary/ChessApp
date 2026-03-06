# backend/app/main.py
import os

import chess
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health
from app.services.gemini_fen import fen_from_image_bytes
from app.services.mate_solver import find_mate_in_1_to_3


app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
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
):
    try:
        image_bytes = await image.read()

        if not image_bytes:
            raise HTTPException(status_code=400, detail="No image uploaded")

        # 1) Gemini Vision -> FEN
        gemini_result = fen_from_image_bytes(image_bytes, image.filename)
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
        stockfish_path = os.environ.get("STOCKFISH_PATH", "/usr/games/stockfish")

        result = find_mate_in_1_to_3(
            fen=fen,
            stockfish_path=stockfish_path,
        )

        # 4) Response
        return {
            "fen": fen,
            "vision_confidence": confidence,
            "mate_found": result is not None,
            "mate_in": result.mate_in if result else None,
            "moves_san": result.moves_san if result else [],
            "moves_uci": result.moves_uci if result else [],
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))