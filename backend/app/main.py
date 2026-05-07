import os
import shutil
import logging
from time import perf_counter
from contextlib import asynccontextmanager
from pathlib import Path

import chess
import redis.asyncio as redis
from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api.errors import install_api_error_handlers
from app.db_auth import get_db
from app.local_auth_user import get_optional_local_auth_user
from app.middleware.rate_limit_middleware import rate_limit_middleware
from app.models_auth import LocalAuthUser
from app.routers import assistant, auth, health, puzzles
from app.services.gemini_fen import fen_from_image_bytes
from app.services.mate_solver import find_mate_in_1_to_3
from app.services.puzzle_submission_service import create_submission_for_user
from app.services.protection_service import (
    RateLimitViolation,
    clear_failed_solve_attempts,
    enforce_engine_lock,
    record_failed_solve_attempt,
    rate_limited_response,
    validate_solve_upload,
    ValidatedSolveUpload,
)
from app.repositories.puzzle_submissions import PuzzleSubmissionCreate

logger = logging.getLogger(__name__)
INVALID_GEMINI_FEN_DETAIL = "Invalid FEN returned from Gemini"
INVALID_POSITION_DETAIL = "Invalid chess position detected"
STOCKFISH_NOT_FOUND_DETAIL = (
    "Stockfish not found. Install Stockfish locally and set STOCKFISH_PATH "
    "to the executable path."
)


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


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _validate_fen_or_raise(fen: str) -> chess.Board:
    try:
        board = chess.Board(fen)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=INVALID_GEMINI_FEN_DETAIL) from exc

    if not board.is_valid():
        raise HTTPException(status_code=422, detail=INVALID_POSITION_DETAIL)
    return board


def _resolve_stockfish_path_or_raise() -> str:
    stockfish_path = (
        os.environ.get("STOCKFISH_PATH")
        or shutil.which("stockfish")
        or "/usr/games/stockfish"
    )
    if Path(stockfish_path).exists() or shutil.which("stockfish") is not None:
        return stockfish_path

    raise HTTPException(status_code=500, detail=STOCKFISH_NOT_FOUND_DETAIL)


def _persist_local_auth_submission(
    *,
    db: Session,
    local_auth_user: LocalAuthUser,
    upload: ValidatedSolveUpload,
    expected_side_to_move: str | None,
    fen: str,
    solve_time_ms: int,
    confidence: float,
    gemini_result: dict,
    result: object,
) -> None:
    create_submission_for_user(
        db=db,
        payload=PuzzleSubmissionCreate(
            user_id=local_auth_user.id,
            file_name=upload.filename or "uploaded-puzzle",
            expected_side_to_move=expected_side_to_move,
            fen=fen,
            solve_time_ms=solve_time_ms,
            puzzle_elo=None,
            position_check={
                "sideToMove": gemini_result.get("side_to_move"),
                "confidence": confidence,
                "attemptsUsed": gemini_result.get("attempts_used"),
                "mateFound": result is not None,
                "mateIn": result.mate_in if result else None,
            },
            solution_lines=result.moves_san if result else [],
            first_move_assessment=None,
        ),
    )


redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis_client = redis.from_url(
        redis_url,
        encoding="utf-8",
        decode_responses=True,
    )
    try:
        await app.state.redis_client.ping()
    except Exception as exc:
        logger.exception("Failed to connect to Redis at startup.")
        raise RuntimeError("Redis is required for /solve rate limiting.") from exc
    try:
        yield
    finally:
        redis_client = getattr(app.state, "redis_client", None)
        if redis_client is not None:
            await redis_client.close()


app = FastAPI(lifespan=lifespan)
install_api_error_handlers(app)

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://0.0.0.0:3000",
    "http://0.0.0.0:3001",
    "http://[::1]:3000",
    "http://[::1]:3001",
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
app.include_router(auth.router)
app.include_router(assistant.router)
app.include_router(puzzles.router)


@app.exception_handler(RateLimitViolation)
async def rate_limit_violation_handler(_: Request, exc: RateLimitViolation):
    return rate_limited_response(message=exc.message, retry_after=exc.retry_after)


@app.middleware("http")
async def global_protection_middleware(request: Request, call_next):
    return await rate_limit_middleware(request, call_next)


@app.get("/")
async def root():
    return {"message": "Backend is running"}


@app.post("/solve")
async def solve(
    request: Request,
    upload: ValidatedSolveUpload = Depends(validate_solve_upload),
    _engine_guard: None = Depends(enforce_engine_lock),
    expected_side_to_move: str | None = Form(None),
    db: Session = Depends(get_db),
    local_auth_user: LocalAuthUser | None = Depends(get_optional_local_auth_user),
):
    started_at = perf_counter()
    try:
        image_bytes = upload.data

        # 1) Gemini Vision -> FEN
        gemini_result = fen_from_image_bytes(
            image_bytes,
            upload.filename,
            expected_side_to_move=expected_side_to_move,
            attempts=max(1, _env_int("GEMINI_TRANSCRIBE_ATTEMPTS", 5)),
        )
        fen = gemini_result["fen"]
        confidence = gemini_result["confidence"]

        # 2) Validate FEN
        _validate_fen_or_raise(fen)

        # 3) Run Stockfish
        stockfish_path = _resolve_stockfish_path_or_raise()

        result = find_mate_in_1_to_3(
            fen=fen,
            stockfish_path=stockfish_path,
            think_time_s=2.0,
            max_mate=3,
        )
        solve_time_ms = max(0, int(round((perf_counter() - started_at) * 1000)))
        gemini_result["side_to_move"] = "white" if chess.Board(fen).turn else "black"
        await clear_failed_solve_attempts(request)

        if local_auth_user is not None:
            _persist_local_auth_submission(
                db=db,
                local_auth_user=local_auth_user,
                upload=upload,
                expected_side_to_move=expected_side_to_move,
                fen=fen,
                solve_time_ms=solve_time_ms,
                confidence=confidence,
                gemini_result=gemini_result,
                result=result,
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

    except HTTPException as exc:
        if exc.status_code in {400, 422}:
            await record_failed_solve_attempt(request)
        raise
    except Exception as exc:
        logger.exception("Unexpected /solve failure: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error.")
