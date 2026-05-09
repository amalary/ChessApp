from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional

from app.services.board_detect import detect_and_normalize_board
from app.services.board_position_service import build_candidates
from app.services.board_preprocess import preprocess_image_bytes
from app.services.board_transcription import transcribe_board_from_squares
from app.services.candidate_ranker import rank_candidates
from app.services.gemini_assist import extract_puzzle_hints
from app.services.mate_solver import EngineCrashedError, MateLine, find_mate_in_1_to_3
from app.services.square_extract import extract_square_images


@dataclass
class SolvePipelineResult:
    chosen_fen: str
    vision_fen: str
    fen_source: str
    validation_direct: bool
    solution: Optional[MateLine]
    transcription: dict
    engine_mode: str
    engine_path: Optional[str]
    engine_errors: List[str]
    candidates_debug: list[dict]


@dataclass(frozen=True)
class EngineConfig:
    think_time_s: float
    max_depth: int
    max_mate: int
    engine_paths: list[str]


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _candidate_stockfish_paths() -> list[str]:
    configured = os.environ.get("STOCKFISH_PATH")
    which_stockfish = shutil.which("stockfish")
    repo_stockfish = (
        Path(__file__).resolve().parents[2]
        / "tools"
        / "stockfish"
        / "stockfish"
        / "stockfish-windows-x86-64-avx2.exe"
    )
    candidates: list[str] = []
    for candidate in (
        configured,
        which_stockfish,
        str(repo_stockfish),
        "/usr/games/stockfish",
    ):
        if not candidate:
            continue
        if candidate not in candidates:
            candidates.append(candidate)
    return candidates


def _existing_paths(paths: Iterable[str]) -> list[str]:
    return [p for p in paths if Path(p).exists() or shutil.which(p) is not None]


def _solve_with_stockfish(
    fen: str,
    think_time_s: float,
    max_depth: int,
    max_mate: int,
    engine_paths: list[str],
) -> tuple[Optional[MateLine], str, Optional[str], list[str]]:
    errors: list[str] = []
    for engine_path in engine_paths:
        try:
            result = find_mate_in_1_to_3(
                fen=fen,
                stockfish_path=engine_path,
                think_time_s=think_time_s,
                max_depth=max_depth,
                max_mate=max_mate,
            )
            return result, "stockfish", engine_path, errors
        except EngineCrashedError as exc:
            errors.append(f"{engine_path}: {exc}")

    raise RuntimeError(
        "Stockfish unavailable or crashed for all configured paths. "
        + ("; ".join(errors) if errors else "No engine path found.")
    )


def _make_transcription_payload(
    board_map: dict[str, str],
    transcription_conf: float,
    uncertain_squares: list[str],
    notes: str,
    hint: dict,
    attempts_used: int,
) -> dict:
    return {
        "fen": "",  # filled by caller based on selected candidate
        "confidence": round(max(0.0, min(1.0, transcription_conf)), 4),
        "orientation_confidence": 0.7,
        "side_to_move": hint.get("side_to_move", "unknown"),
        "square_confidence": {},
        "low_confidence_squares": uncertain_squares,
        "unknown_squares": uncertain_squares,
        "notes": notes,
        "attempts_used": attempts_used,
        "needs_user_confirmation": len(uncertain_squares) > 0,
        "board_map": board_map,
    }


def _validate_expected_mate_in(expected_mate_in: int | None) -> None:
    if expected_mate_in is not None and expected_mate_in not in {1, 2, 3}:
        raise ValueError("expected_mate_in must be 1, 2, or 3.")


def _resolve_side_options(expected_side_to_move: str, side_hint: str) -> list[str]:
    requested_side = (
        expected_side_to_move
        if expected_side_to_move in {"white", "black"}
        else "white"
    )
    side_options = [requested_side]
    if side_hint in {"white", "black"} and side_hint not in side_options:
        side_options.append(side_hint)
    fallback_side = "black" if requested_side == "white" else "white"
    if fallback_side not in side_options:
        side_options.append(fallback_side)
    return side_options


def _select_valid_candidates(
    transcribed: object, side_options: list[str]
) -> list[object]:
    candidates = build_candidates(
        board_map=transcribed.board_map,
        side_options=side_options,
        base_confidence=transcribed.confidence,
        uncertain_squares=transcribed.uncertain_squares,
    )
    valid_candidates = [
        candidate for candidate in candidates if candidate.validation.passed
    ]
    if valid_candidates:
        return valid_candidates
    raise ValueError(
        "No valid candidate positions after transcription, validation, and repair."
    )


def _resolve_engine_config() -> EngineConfig:
    return EngineConfig(
        think_time_s=max(0.5, _env_float("MATE_THINK_TIME_S", 3.0)),
        max_depth=max(10, _env_int("MATE_MAX_DEPTH", 26)),
        max_mate=min(3, max(1, _env_int("MATE_MAX_MOVES", 3))),
        engine_paths=_existing_paths(_candidate_stockfish_paths()),
    )


def _solve_candidates(
    valid_candidates: list[object],
    engine_config: EngineConfig,
) -> tuple[dict[str, Optional[MateLine]], str, Optional[str], list[str]]:
    mate_by_fen: dict[str, Optional[MateLine]] = {}
    engine_mode = "stockfish"
    engine_path = None
    engine_errors: list[str] = []
    for candidate in valid_candidates:
        line, mode, used_path, errs = _solve_with_stockfish(
            fen=candidate.fen,
            think_time_s=engine_config.think_time_s,
            max_depth=engine_config.max_depth,
            max_mate=engine_config.max_mate,
            engine_paths=engine_config.engine_paths,
        )
        mate_by_fen[candidate.fen] = line
        engine_mode = mode
        engine_path = used_path
        engine_errors.extend(errs)
    return mate_by_fen, engine_mode, engine_path, engine_errors


def _validate_chosen_mate_in(
    *,
    expected_mate_in: int | None,
    chosen_mate_line: Optional[MateLine],
) -> None:
    if expected_mate_in is None:
        return
    if chosen_mate_line is None:
        raise ValueError(
            f"Expected mate in {expected_mate_in}, but no forced mate found."
        )
    if chosen_mate_line.mate_in != expected_mate_in:
        raise ValueError(
            f"Expected mate in {expected_mate_in}, but found mate in {chosen_mate_line.mate_in}."
        )


def _build_candidates_debug(
    valid_candidates: list[object],
    mate_by_fen: dict[str, Optional[MateLine]],
) -> list[dict]:
    return [
        {
            "fen": candidate.fen,
            "source": candidate.source,
            "validation_passed": candidate.validation.passed,
            "validation_reasons": candidate.validation.reasons,
            "repair_applied": candidate.repair_applied,
            "transcription_confidence": candidate.confidence,
            "mate_found": mate_by_fen.get(candidate.fen) is not None,
            "mate_in": (
                mate_by_fen[candidate.fen].mate_in
                if mate_by_fen.get(candidate.fen)
                else None
            ),
        }
        for candidate in valid_candidates
    ]


def run_solve_pipeline(
    image_bytes: bytes,
    filename: str | None,
    expected_side_to_move: str,
    board_perspective: str | None,
    expected_mate_in: int | None = None,
) -> SolvePipelineResult:
    _validate_expected_mate_in(expected_mate_in)

    # 1) image preprocessing
    pre = preprocess_image_bytes(image_bytes)

    # 2) board detection / normalization
    detect = detect_and_normalize_board(pre.image)

    # 3) square extraction
    squares = extract_square_images(detect.board_image)

    # 4) board transcription (deterministic baseline, non-Gemini primary)
    transcribed = transcribe_board_from_squares(squares.square_images)

    # 5) optional Gemini helper for puzzle text hints only
    hint = extract_puzzle_hints(image_bytes=image_bytes, filename=filename)
    side_hint = hint.get("side_to_move", "unknown")
    side_options = _resolve_side_options(expected_side_to_move, side_hint)

    # 6) candidate generation + validation/repair
    valid_candidates = _select_valid_candidates(transcribed, side_options)

    # 7) solve with Stockfish only (mate in 1..3)
    engine_config = _resolve_engine_config()
    mate_by_fen, engine_mode, engine_path, engine_errors = _solve_candidates(
        valid_candidates=valid_candidates,
        engine_config=engine_config,
    )

    # 8) rank candidates
    ranked = rank_candidates(
        valid_candidates, mate_by_fen=mate_by_fen, side_hint=side_hint
    )
    chosen = ranked[0]

    _validate_chosen_mate_in(
        expected_mate_in=expected_mate_in,
        chosen_mate_line=chosen.mate_line,
    )

    transcription = _make_transcription_payload(
        board_map=transcribed.board_map,
        transcription_conf=transcribed.confidence,
        uncertain_squares=transcribed.uncertain_squares,
        notes=f"deterministic_transcription:{transcribed.notes}",
        hint=hint,
        attempts_used=1,
    )
    transcription["fen"] = chosen.candidate.fen
    transcription["side_to_move"] = chosen.candidate.side_to_move

    return SolvePipelineResult(
        chosen_fen=chosen.candidate.fen,
        vision_fen=chosen.candidate.fen,
        fen_source=chosen.candidate.source,
        validation_direct=(not chosen.candidate.repair_applied),
        solution=chosen.mate_line,
        transcription=transcription,
        engine_mode=engine_mode,
        engine_path=engine_path,
        engine_errors=engine_errors,
        candidates_debug=_build_candidates_debug(valid_candidates, mate_by_fen),
    )
