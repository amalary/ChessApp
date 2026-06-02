import os
import re
import shutil
import logging
import base64
import uuid
from datetime import datetime
from io import BytesIO
from time import perf_counter
from contextlib import asynccontextmanager
from pathlib import Path

import chess
import redis.asyncio as redis
from PIL import Image
from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api.errors import install_api_error_handlers
from app.auth0 import get_current_user
from app.db_auth import get_db
from app.evals.trace_logger import log_solve_trace
from app.local_auth_user import get_optional_local_auth_user_from_current_user
from app.middleware.rate_limit_middleware import rate_limit_middleware
from app.models_auth import LocalAuthUser
from app.routes.agent import router as agent_router
from app.routers import assistant, auth, health, puzzles
from app.services.gemini_fen import fen_from_image_bytes
from app.services.mate_solver import find_mate_in_1_to_3
from app.services.puzzle_submission_service import create_submission_for_user
from app.services.puzzle_submission_service import estimate_puzzle_difficulty_rating
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
UCI_MOVE_PATTERN = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")
ENV_OVERRIDE_KEYS = {
    "DATABASE_URL",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
    "DB_HOST",
    "DB_PORT",
}


def _load_env_file(
    path: Path,
    *,
    override_existing: bool = False,
    override_keys: set[str] | None = None,
    skip_keys: set[str] | None = None,
) -> None:
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
        if skip_keys and key in skip_keys:
            continue
        should_override = bool(override_keys and key in override_keys)
        if key and (key not in os.environ or override_existing or should_override):
            os.environ[key] = value


def _bootstrap_env() -> None:
    app_env = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).lower()
    if app_env in {"production", "prod"}:
        if "GOOGLE_API_KEY" not in os.environ and "GEMINI_API_KEY" in os.environ:
            os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]
        return

    here = Path(__file__).resolve()
    backend_env = here.parents[1] / ".env"
    _load_env_file(
        backend_env,
        override_existing=True,
        override_keys=ENV_OVERRIDE_KEYS,
    )

    candidates = [Path.cwd() / ".env", here.parents[2] / ".env"]
    for parent in here.parents:
        candidates.append(parent / "ChessApp" / ".env")

    backend_env_resolved = backend_env.resolve()
    for env_path in candidates:
        if env_path.exists() and env_path.resolve() == backend_env_resolved:
            continue
        # Keep sensitive runtime wiring (API/database keys) sourced from backend/.env.
        _load_env_file(env_path, skip_keys=ENV_OVERRIDE_KEYS)

    if "GOOGLE_API_KEY" not in os.environ and "GEMINI_API_KEY" in os.environ:
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]


_bootstrap_env()


def _env_csv(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name, "")
    if not raw.strip():
        return default
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


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


def _normalize_uci_move(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip().lower()
    if not candidate:
        return None
    if not UCI_MOVE_PATTERN.fullmatch(candidate):
        return None
    return candidate


def _extract_first_uci_move(result: object | None) -> str | None:
    if result is None:
        return None
    moves = getattr(result, "moves_uci", None)
    if not isinstance(moves, list):
        return None
    for move in moves:
        if isinstance(move, str):
            normalized = _normalize_uci_move(move)
            if normalized:
                return normalized
    return None


def _classify_first_move(
    attempted_move: str | None, best_move: str | None
) -> tuple[str, bool]:
    normalized_attempt = _normalize_uci_move(attempted_move)
    normalized_best = _normalize_uci_move(best_move)
    if normalized_attempt is None or normalized_best is None:
        return "incorrect", False

    attempt_core = normalized_attempt[:4]
    best_core = normalized_best[:4]
    if attempt_core == best_core:
        return "correct", True

    same_source = attempt_core[:2] == best_core[:2]
    same_destination = attempt_core[2:4] == best_core[2:4]
    if same_source or same_destination:
        return "almost_correct", False
    return "incorrect", False


def _build_first_move_assessment(
    *,
    first_move_uci: str | None,
    time_to_first_move_seconds: float | None,
    best_move: str | None,
    confidence: float,
    fen: str,
    result: object | None,
    puzzle_id: str | None,
    attempt_id: str | None,
    attempt_created_at: str | None,
    user_id: str | None,
) -> dict | None:
    normalized_first_move = _normalize_uci_move(first_move_uci)
    if normalized_first_move is None:
        return None

    status, is_first_move_correct = _classify_first_move(
        normalized_first_move, best_move
    )
    first_move_threshold = max(
        0.0, min(1.0, _env_float("FIRST_MOVE_MIN_CONFIDENCE", 0.75))
    )
    invalid_reason = None

    if confidence < first_move_threshold:
        invalid_reason = "low_vision_confidence"
    else:
        try:
            board = chess.Board(fen)
            if not board.is_valid():
                invalid_reason = "invalid_fen"
        except Exception:
            invalid_reason = "invalid_fen"

    if invalid_reason is None and (result is None or best_move is None):
        invalid_reason = "stockfish_no_mate"

    is_valid_for_first_move_accuracy = invalid_reason is None
    normalized_time = (
        round(max(0.0, float(time_to_first_move_seconds or 0.0)), 2)
        if isinstance(time_to_first_move_seconds, (int, float))
        else 0.0
    )
    normalized_puzzle_id = (
        puzzle_id.strip()
        if isinstance(puzzle_id, str) and puzzle_id.strip()
        else f"fen:{fen.strip()}"
    )
    normalized_attempt_id = (
        attempt_id.strip()
        if isinstance(attempt_id, str) and attempt_id.strip()
        else f"attempt-{int(perf_counter() * 1000)}"
    )
    normalized_created_at = (
        attempt_created_at.strip()
        if isinstance(attempt_created_at, str) and attempt_created_at.strip()
        else datetime.utcnow().isoformat()
    )
    return {
        "firstMove": normalized_first_move,
        "bestMove": best_move,
        "isFirstMoveCorrect": is_first_move_correct,
        "status": status,
        "timeToFirstMoveSeconds": normalized_time,
        "puzzleId": normalized_puzzle_id,
        "userId": user_id,
        "attemptId": normalized_attempt_id,
        "createdAt": normalized_created_at,
        "isValidForFirstMoveAccuracy": is_valid_for_first_move_accuracy,
        "invalidReason": invalid_reason,
    }


def _validate_fen_or_raise(fen: str) -> chess.Board:
    try:
        board = chess.Board(fen)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=INVALID_GEMINI_FEN_DETAIL) from exc

    if not board.is_valid():
        raise HTTPException(status_code=422, detail=INVALID_POSITION_DETAIL)
    return board


def _resolve_stockfish_path_or_raise() -> str:
    bundled_stockfish_path = (
        Path(__file__).resolve().parents[2]
        / "tools"
        / "stockfish"
        / "stockfish"
        / "stockfish-windows-x86-64-avx2.exe"
    )
    stockfish_path = (
        os.environ.get("STOCKFISH_PATH")
        or shutil.which("stockfish")
        or (
            str(bundled_stockfish_path)
            if bundled_stockfish_path.exists()
            else None
        )
        or "/usr/games/stockfish"
    )
    if Path(stockfish_path).exists() or shutil.which("stockfish") is not None:
        return stockfish_path

    raise HTTPException(status_code=500, detail=STOCKFISH_NOT_FOUND_DETAIL)


def _create_submission_image_data_url(image_bytes: bytes) -> str | None:
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            normalized = image.convert("RGB")
            max_dimension = 320
            largest_dimension = max(normalized.width, normalized.height)
            if largest_dimension > max_dimension:
                scale = max_dimension / float(largest_dimension)
                target_width = max(1, int(round(normalized.width * scale)))
                target_height = max(1, int(round(normalized.height * scale)))
                resampling = (
                    Image.Resampling.LANCZOS
                    if hasattr(Image, "Resampling")
                    else Image.LANCZOS
                )
                normalized = normalized.resize(
                    (target_width, target_height), resampling
                )

            with BytesIO() as output:
                normalized.save(output, format="JPEG", quality=80, optimize=True)
                encoded = base64.b64encode(output.getvalue()).decode("ascii")
                return f"data:image/jpeg;base64,{encoded}"
    except Exception:
        return None


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
    first_move_uci: str | None,
    time_to_first_move_seconds: float | None,
    difficulty_rating: int | None,
    puzzle_id: str | None,
    attempt_id: str | None,
    attempt_created_at: str | None,
) -> None:
    best_move = _extract_first_uci_move(result)
    first_move_assessment = _build_first_move_assessment(
        first_move_uci=first_move_uci,
        time_to_first_move_seconds=time_to_first_move_seconds,
        best_move=best_move,
        confidence=confidence,
        fen=fen,
        result=result,
        puzzle_id=puzzle_id,
        attempt_id=attempt_id,
        attempt_created_at=attempt_created_at,
        user_id=str(local_auth_user.id),
    )
    estimated_difficulty_rating = estimate_puzzle_difficulty_rating(
        solve_time_ms=solve_time_ms,
        mate_in=result.mate_in if result else None,
        confidence=confidence,
        attempts_used=gemini_result.get("attempts_used"),
        solution_lines=result.moves_san if result else [],
    )
    normalized_difficulty_rating = (
        difficulty_rating
        if isinstance(difficulty_rating, int) and 100 <= difficulty_rating <= 4000
        else None
    )
    original_puzzle_image_data_url = _create_submission_image_data_url(upload.data)
    create_submission_for_user(
        db=db,
        payload=PuzzleSubmissionCreate(
            user_id=local_auth_user.id,
            file_name=upload.filename or "uploaded-puzzle",
            expected_side_to_move=expected_side_to_move,
            fen=fen,
            solve_time_ms=solve_time_ms,
            puzzle_elo=normalized_difficulty_rating or estimated_difficulty_rating,
            difficulty_rating=normalized_difficulty_rating,
            estimated_difficulty_rating=estimated_difficulty_rating,
            original_puzzle_image_data_url=original_puzzle_image_data_url,
            position_check={
                "sideToMove": gemini_result.get("side_to_move"),
                "confidence": confidence,
                "attemptsUsed": gemini_result.get("attempts_used"),
                "mateFound": result is not None,
                "mateIn": result.mate_in if result else None,
            },
            solution_lines=result.moves_san if result else [],
            first_move_assessment=first_move_assessment,
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

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://[::1]:3000",
    "http://[::1]:3001",
]
origins = _env_csv("CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ORIGINS)
origin_regex = os.getenv(
    "CORS_ALLOWED_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|\[::1\]):\d+$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Local-Auth-User-Id",
        "X-Local-Auth-Session",
    ],
)

# Existing health router
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(assistant.router)
app.include_router(puzzles.router)
app.include_router(agent_router, prefix="/agent")


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
    current_user: dict = Depends(get_current_user),
    upload: ValidatedSolveUpload = Depends(validate_solve_upload),
    _engine_guard: None = Depends(enforce_engine_lock),
    expected_side_to_move: str | None = Form(None),
    first_move_uci: str | None = Form(None),
    time_to_first_move_seconds: float | None = Form(None),
    difficulty_rating: int | None = Form(None),
    puzzle_id: str | None = Form(None),
    attempt_id: str | None = Form(None),
    attempt_created_at: str | None = Form(None),
    db: Session = Depends(get_db),
):
    started_at = perf_counter()
    trace_id = str(uuid.uuid4())
    gemini_raw_output: object | None = None
    parsed_fen: str | None = None
    fen_valid = False
    stockfish_best_move: str | None = None
    stockfish_mate_depth: int | None = None
    final_response: dict | None = None
    error_message: str | None = None
    try:
        image_bytes = upload.data

        # 1) Gemini Vision -> FEN
        gemini_result = fen_from_image_bytes(
            image_bytes,
            upload.filename,
            expected_side_to_move=expected_side_to_move,
            attempts=max(1, _env_int("GEMINI_TRANSCRIBE_ATTEMPTS", 5)),
        )
        gemini_raw_output = gemini_result.get("raw_output")
        fen = gemini_result["fen"]
        parsed_fen = fen
        confidence = gemini_result["confidence"]

        # 2) Validate FEN
        _validate_fen_or_raise(fen)
        fen_valid = True

        # 3) Run Stockfish
        stockfish_path = _resolve_stockfish_path_or_raise()

        result = find_mate_in_1_to_3(
            fen=fen,
            stockfish_path=stockfish_path,
            think_time_s=2.0,
            max_mate=3,
        )
        stockfish_best_move = _extract_first_uci_move(result)
        stockfish_mate_depth = result.mate_in if result else None
        solve_time_ms = max(0, int(round((perf_counter() - started_at) * 1000)))
        gemini_result["side_to_move"] = "white" if chess.Board(fen).turn else "black"
        await clear_failed_solve_attempts(request)

        final_response = {
            "fen": fen,
            "vision_confidence": confidence,
            "vision_side_to_move": gemini_result.get("side_to_move"),
            "vision_attempts_used": gemini_result.get("attempts_used"),
            "mate_found": result is not None,
            "mate_in": result.mate_in if result else None,
            "moves_san": result.moves_san if result else [],
            "moves_uci": result.moves_uci if result else [],
        }

        try:
            local_auth_user = get_optional_local_auth_user_from_current_user(
                current_user,
                db,
            )
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
                    first_move_uci=first_move_uci,
                    time_to_first_move_seconds=time_to_first_move_seconds,
                    difficulty_rating=difficulty_rating,
                    puzzle_id=puzzle_id,
                    attempt_id=attempt_id,
                    attempt_created_at=attempt_created_at,
                )
        except Exception as exc:
            db.rollback()
            logger.exception("Failed to persist /solve submission: %s", exc)

        return final_response

    except HTTPException as exc:
        error_message = str(exc.detail)
        if exc.status_code in {400, 422}:
            await record_failed_solve_attempt(request)
        raise
    except Exception as exc:
        error_message = str(exc)
        logger.exception("Unexpected /solve failure: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error.")
    finally:
        latency_ms = max(0, int(round((perf_counter() - started_at) * 1000)))
        log_solve_trace(
            trace_id=trace_id,
            image_filename=upload.filename,
            gemini_raw_output=gemini_raw_output,
            parsed_fen=parsed_fen,
            fen_valid=fen_valid,
            stockfish_best_move=stockfish_best_move,
            stockfish_mate_depth=stockfish_mate_depth,
            final_response=final_response,
            latency_ms=latency_ms,
            error_message=error_message,
        )
