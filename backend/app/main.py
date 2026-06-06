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
from app.services.board_position_service import CandidateBoard, validate_fen
from app.services.candidate_ranker import rank_candidates
from app.services.gemini_fen import fen_from_image_bytes
from app.services.mate_solver import find_best_engine_line, find_mate_in_1_to_3
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
UNCERTAIN_POSITION_DETAIL = (
    "Could not read the board reliably. Please crop the board squarely and try again."
)
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


def _form_value_or_none(value: object) -> object | None:
    if value is None or isinstance(value, (str, int, float)):
        return value
    return None


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


def _candidate_fens_from_gemini_result(gemini_result: dict) -> list[dict]:
    selected_fen = gemini_result.get("fen")
    selected_confidence = gemini_result.get("confidence")
    selected_side = gemini_result.get("side_to_move")
    candidates = gemini_result.get("candidates")

    rows: list[dict] = []
    if isinstance(candidates, list):
        rows.extend(row for row in candidates if isinstance(row, dict))

    if isinstance(selected_fen, str) and selected_fen.strip():
        rows.insert(
            0,
            {
                "fen": selected_fen,
                "confidence": (
                    selected_confidence
                    if isinstance(selected_confidence, (int, float))
                    else 0.0
                ),
                "side_to_move": selected_side,
                "is_valid": True,
            },
        )

    merged_by_fen: dict[str, dict] = {}
    order: list[str] = []
    for row in rows:
        fen = row.get("fen")
        if not isinstance(fen, str) or not fen.strip():
            continue
        if fen not in merged_by_fen:
            merged_by_fen[fen] = {"fen": fen}
            order.append(fen)
        merged = merged_by_fen[fen]
        for key, value in row.items():
            if value is not None:
                merged[key] = value

    unique_rows: list[dict] = []
    seen: set[str] = set()
    for fen in order:
        if fen in seen:
            continue
        seen.add(fen)
        unique_rows.append(merged_by_fen[fen])
    return unique_rows


def _candidate_confidence(row: dict) -> float:
    try:
        return max(0.0, min(1.0, float(row.get("confidence", 0.0))))
    except (TypeError, ValueError):
        return 0.0


def _candidate_vote_count(row: dict) -> int:
    return _as_positive_int(row.get("vote_count"), 1) or 1


def _bounded_solver_time(
    name: str, default: float, minimum: float, maximum: float
) -> float:
    return max(minimum, min(maximum, _env_float(name, default)))


def _candidate_rows_for_engine_selection(gemini_result: dict) -> list[dict]:
    rows = _candidate_fens_from_gemini_result(gemini_result)
    attempts_used = _as_positive_int(gemini_result.get("attempts_used"), len(rows))
    required_votes = min(
        max(1, _env_int("GEMINI_MIN_CONSENSUS_VOTES", 2)),
        max(1, attempts_used),
    )

    stable_rows: list[dict] = []
    for row in rows:
        if row.get("is_valid") is False:
            continue
        if "side_matches_expected" in row and not bool(
            row.get("side_matches_expected")
        ):
            continue
        if _candidate_vote_count(row) < required_votes:
            continue
        stable_rows.append(row)

    if not stable_rows:
        selected_fen = gemini_result.get("fen")
        selected = next(
            (
                row
                for row in rows
                if isinstance(selected_fen, str) and row.get("fen") == selected_fen
            ),
            None,
        )
        return [selected] if selected is not None else []

    stable_rows.sort(
        key=lambda row: (_candidate_vote_count(row), _candidate_confidence(row)),
        reverse=True,
    )
    limit = max(1, _env_int("SOLVER_CANDIDATE_EVALUATION_LIMIT", 4))
    return stable_rows[:limit]


def _candidate_board_from_row(row: dict) -> CandidateBoard | None:
    fen = row.get("fen")
    if not isinstance(fen, str) or not fen.strip():
        return None
    validation = validate_fen(fen)
    if not validation.passed:
        return None

    side = row.get("side_to_move")
    if not isinstance(side, str) or not side.strip():
        try:
            side = "white" if chess.Board(fen).turn else "black"
        except Exception:
            side = ""

    return CandidateBoard(
        fen=fen,
        source="gemini_consensus_candidate",
        board_map={},
        side_to_move=side,
        repair_applied=False,
        validation=validation,
        confidence=_candidate_confidence(row),
        uncertain_squares=[],
    )


def _promote_best_valid_candidate(gemini_result: dict) -> CandidateBoard | None:
    rows = _candidate_fens_from_gemini_result(gemini_result)
    candidates = [
        candidate
        for row in rows
        if (candidate := _candidate_board_from_row(row)) is not None
    ]
    if not candidates:
        return None

    candidates.sort(
        key=lambda candidate: (
            _candidate_vote_count(
                _matching_candidate_for_fen(gemini_result, candidate.fen) or {}
            ),
            candidate.confidence,
        ),
        reverse=True,
    )
    candidate = candidates[0]
    _apply_candidate_selection(gemini_result, candidate)
    return candidate


def _apply_candidate_selection(gemini_result: dict, candidate: CandidateBoard) -> None:
    row = _matching_candidate_for_fen(gemini_result, candidate.fen)
    gemini_result["fen"] = candidate.fen
    gemini_result["confidence"] = candidate.confidence
    gemini_result["side_to_move"] = candidate.side_to_move
    if isinstance(row, dict):
        if "vote_count" in row:
            gemini_result["consensus_votes"] = row.get("vote_count")
        if "side_matches_expected" in row:
            gemini_result["side_matches_expected"] = row.get("side_matches_expected")


def _find_best_verified_candidate(
    *,
    gemini_result: dict,
    stockfish_path: str,
    selected_fen: str,
    side_hint: str | None,
    mate_think_time_s: float,
) -> tuple[CandidateBoard | None, object | None]:
    rows = _candidate_rows_for_engine_selection(gemini_result)
    candidates = [
        candidate
        for row in rows
        if (candidate := _candidate_board_from_row(row)) is not None
    ]
    if not candidates:
        return None, None

    selected_candidate = next(
        (candidate for candidate in candidates if candidate.fen == selected_fen),
        None,
    )
    if selected_candidate is None:
        selected_row = _matching_candidate_for_fen(gemini_result, selected_fen)
        if selected_row is not None:
            selected_candidate = _candidate_board_from_row(selected_row)
            if selected_candidate is not None:
                candidates.append(selected_candidate)

    mate_by_fen: dict[str, object | None] = {}
    for candidate in candidates:
        if candidate.fen in mate_by_fen:
            continue
        mate_by_fen[candidate.fen] = find_mate_in_1_to_3(
            fen=candidate.fen,
            stockfish_path=stockfish_path,
            think_time_s=mate_think_time_s,
            max_mate=3,
        )

    ranked = rank_candidates(
        candidates,
        mate_by_fen=mate_by_fen,
        side_hint=side_hint,
    )
    if not ranked:
        return selected_candidate, None

    top = ranked[0]
    selected_mate = mate_by_fen.get(selected_fen)
    if top.candidate.fen != selected_fen and top.mate_line is not None:
        return top.candidate, top.mate_line
    if selected_candidate is not None:
        return selected_candidate, selected_mate
    return top.candidate, top.mate_line


def _matching_candidate_for_fen(gemini_result: dict, fen: str) -> dict | None:
    candidates = gemini_result.get("candidates")
    if isinstance(candidates, list):
        for row in candidates:
            if isinstance(row, dict) and row.get("fen") == fen:
                return row

    selected_fen = gemini_result.get("fen")
    if selected_fen == fen:
        row = {
            "fen": selected_fen,
            "confidence": gemini_result.get("confidence"),
            "side_to_move": gemini_result.get("side_to_move"),
            "is_valid": True,
            "vote_count": gemini_result.get("consensus_votes"),
        }
        if "side_matches_expected" in gemini_result:
            row["side_matches_expected"] = gemini_result.get("side_matches_expected")
        return row
    return None


def _as_positive_int(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, parsed)


def _solver_confidence_label(confidence: float) -> str:
    if confidence >= 0.9:
        return "high"
    if confidence >= 0.75:
        return "medium"
    return "low"


def _build_solver_confidence(
    *,
    gemini_result: dict,
    vision_confidence: float,
    mate_found: bool,
    result: object | None,
) -> float:
    candidates = gemini_result.get("candidates")
    attempts_used = _as_positive_int(gemini_result.get("attempts_used"), 1)
    selected_row = _matching_candidate_for_fen(
        gemini_result, str(gemini_result.get("fen", ""))
    )
    consensus_votes = _as_positive_int(
        gemini_result.get("consensus_votes"),
        _as_positive_int(
            selected_row.get("vote_count") if isinstance(selected_row, dict) else None,
            1,
        ),
    )
    if consensus_votes == 0:
        consensus_votes = 1
    unique_fen_count = _as_positive_int(gemini_result.get("unique_fen_count"), 1)
    if isinstance(candidates, list) and candidates:
        unique_fen_count = max(
            unique_fen_count,
            len(
                {
                    row.get("fen")
                    for row in candidates
                    if isinstance(row, dict) and isinstance(row.get("fen"), str)
                }
            ),
        )

    required_attempts_for_full_consensus = max(
        3, _env_int("GEMINI_MIN_CONSENSUS_VOTES", 2)
    )
    attempt_coverage = min(1.0, attempts_used / required_attempts_for_full_consensus)
    consensus_ratio = min(1.0, consensus_votes / max(1, attempts_used))
    consensus_strength = consensus_ratio * attempt_coverage
    uniqueness_component = (
        0.05
        if unique_fen_count <= 1
        else max(0.0, 0.05 - (unique_fen_count - 1) * 0.02)
    )
    engine_component = 0.15 if mate_found else (0.08 if result is not None else 0.0)

    side_component = 0.03
    if isinstance(selected_row, dict) and "side_matches_expected" in selected_row:
        side_component = (
            0.05 if bool(selected_row.get("side_matches_expected")) else 0.0
        )

    score = (
        max(0.0, min(1.0, vision_confidence)) * 0.45
        + consensus_strength * 0.35
        + engine_component
        + uniqueness_component
        + side_component
    )
    return round(max(0.0, min(1.0, score)), 4)


def _assert_stable_transcription_or_raise(gemini_result: dict) -> None:
    candidates = gemini_result.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return

    fen = gemini_result.get("fen")
    if not isinstance(fen, str) or not fen.strip():
        raise HTTPException(status_code=422, detail=UNCERTAIN_POSITION_DETAIL)

    selected_row = _matching_candidate_for_fen(gemini_result, fen)
    if selected_row is None:
        raise HTTPException(status_code=422, detail=UNCERTAIN_POSITION_DETAIL)

    attempts_used = _as_positive_int(
        gemini_result.get("attempts_used"), len(candidates)
    )
    configured_min_votes = max(1, _env_int("GEMINI_MIN_CONSENSUS_VOTES", 2))
    required_votes = min(configured_min_votes, max(1, attempts_used))
    selected_votes = _as_positive_int(
        selected_row.get("vote_count"),
        _as_positive_int(gemini_result.get("consensus_votes"), 1),
    )
    unique_fen_count = _as_positive_int(
        gemini_result.get("unique_fen_count"),
        len({row.get("fen") for row in candidates if isinstance(row, dict)}),
    )

    expected_side_was_checked = any(
        isinstance(row, dict) and "side_matches_expected" in row for row in candidates
    )
    if expected_side_was_checked and not bool(
        selected_row.get("side_matches_expected")
    ):
        raise HTTPException(status_code=422, detail=UNCERTAIN_POSITION_DETAIL)

    if selected_votes < required_votes:
        raise HTTPException(status_code=422, detail=UNCERTAIN_POSITION_DETAIL)

    if attempts_used >= configured_min_votes and unique_fen_count > 1:
        top_votes = sorted(
            (
                _as_positive_int(row.get("vote_count"), 1)
                for row in candidates
                if isinstance(row, dict)
            ),
            reverse=True,
        )
        if len(top_votes) > 1 and top_votes[0] == top_votes[1]:
            raise HTTPException(status_code=422, detail=UNCERTAIN_POSITION_DETAIL)


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
        or (str(bundled_stockfish_path) if bundled_stockfish_path.exists() else None)
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
    mate_found: bool,
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
                "rawVisionConfidence": gemini_result.get("confidence"),
                "solverConfidenceLabel": _solver_confidence_label(confidence),
                "attemptsUsed": gemini_result.get("attempts_used"),
                "consensusVotes": gemini_result.get("consensus_votes"),
                "uniqueFenCount": gemini_result.get("unique_fen_count"),
                "mateFound": mate_found,
                "mateIn": result.mate_in if mate_found and result else None,
            },
            solution_lines=result.moves_san if result else [],
            first_move_assessment=first_move_assessment,
        ),
    )


redis_url = os.getenv("REDIS_URL", "").strip()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis_client = None
    if redis_url:
        app.state.redis_client = redis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        try:
            await app.state.redis_client.ping()
        except Exception:
            logger.exception(
                "Failed to connect to Redis at startup; continuing without Redis."
            )
            await app.state.redis_client.close()
            app.state.redis_client = None
    else:
        logger.warning("REDIS_URL is not set; continuing without Redis.")
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
        expected_side_to_move = _form_value_or_none(expected_side_to_move)  # type: ignore[assignment]
        first_move_uci = _form_value_or_none(first_move_uci)  # type: ignore[assignment]
        time_to_first_move_seconds = _form_value_or_none(time_to_first_move_seconds)  # type: ignore[assignment]
        difficulty_rating = _form_value_or_none(difficulty_rating)  # type: ignore[assignment]
        puzzle_id = _form_value_or_none(puzzle_id)  # type: ignore[assignment]
        attempt_id = _form_value_or_none(attempt_id)  # type: ignore[assignment]
        attempt_created_at = _form_value_or_none(attempt_created_at)  # type: ignore[assignment]
        image_bytes = upload.data

        # 1) Gemini Vision -> FEN
        gemini_result = fen_from_image_bytes(
            image_bytes,
            upload.filename,
            expected_side_to_move=expected_side_to_move,
            attempts=max(1, _env_int("GEMINI_TRANSCRIBE_ATTEMPTS", 5)),
            include_candidates=True,
        )
        gemini_raw_output = gemini_result.get("raw_output")
        fen = gemini_result["fen"]
        parsed_fen = fen
        confidence = gemini_result["confidence"]

        # 2) Validate FEN
        try:
            _validate_fen_or_raise(fen)
        except HTTPException as exc:
            if exc.status_code != 422:
                raise
            selected_candidate = _promote_best_valid_candidate(gemini_result)
            if selected_candidate is None:
                raise
            fen = selected_candidate.fen
            parsed_fen = fen
            confidence = gemini_result["confidence"]
        _assert_stable_transcription_or_raise(gemini_result)
        fen_valid = True

        # 3) Run Stockfish across stable readings and prefer verified short mates.
        stockfish_path = _resolve_stockfish_path_or_raise()
        mate_think_time_s = _bounded_solver_time(
            "SOLVER_MATE_THINK_TIME_SECONDS",
            default=12.0,
            minimum=1.0,
            maximum=30.0,
        )
        best_line_think_time_s = _bounded_solver_time(
            "SOLVER_BEST_LINE_THINK_TIME_SECONDS",
            default=8.0,
            minimum=1.0,
            maximum=20.0,
        )
        selected_candidate, result = _find_best_verified_candidate(
            gemini_result=gemini_result,
            stockfish_path=stockfish_path,
            selected_fen=fen,
            side_hint=expected_side_to_move,
            mate_think_time_s=mate_think_time_s,
        )
        if selected_candidate is not None and selected_candidate.fen != fen:
            _apply_candidate_selection(gemini_result, selected_candidate)
            fen = selected_candidate.fen
            parsed_fen = fen
            confidence = gemini_result["confidence"]

        mate_found = result is not None
        if result is None:
            result = find_best_engine_line(
                fen=fen,
                stockfish_path=stockfish_path,
                think_time_s=best_line_think_time_s,
            )
        stockfish_best_move = _extract_first_uci_move(result)
        stockfish_mate_depth = result.mate_in if mate_found and result else None
        solver_confidence = _build_solver_confidence(
            gemini_result=gemini_result,
            vision_confidence=confidence,
            mate_found=mate_found,
            result=result,
        )
        solver_confidence_label = _solver_confidence_label(solver_confidence)
        solve_time_ms = max(0, int(round((perf_counter() - started_at) * 1000)))
        gemini_result["side_to_move"] = "white" if chess.Board(fen).turn else "black"
        await clear_failed_solve_attempts(request)

        final_response = {
            "fen": fen,
            "vision_confidence": confidence,
            "solver_confidence": solver_confidence,
            "solver_confidence_label": solver_confidence_label,
            "vision_side_to_move": gemini_result.get("side_to_move"),
            "vision_attempts_used": gemini_result.get("attempts_used"),
            "vision_consensus_votes": gemini_result.get("consensus_votes"),
            "vision_unique_fen_count": gemini_result.get("unique_fen_count"),
            "mate_found": mate_found,
            "mate_in": result.mate_in if mate_found and result else None,
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
                    confidence=solver_confidence,
                    gemini_result=gemini_result,
                    result=result,
                    mate_found=mate_found,
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
