from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth0 import get_optional_current_user
from app.db_auth import get_db
from app.local_auth_user import get_optional_local_auth_user
from app.models_auth import LocalAuthUser
from app.services.chess_agent import assistant_agent
from app.services.puzzle_submission_service import (
    build_submission_history_context_for_user,
)
from app.services.user_context import build_agent_user_profile_context

router = APIRouter(tags=["assistant"])
logger = logging.getLogger(__name__)


class AssistantRequest(BaseModel):
    puzzle_id: str | None = Field(default=None)
    fen: str | None = Field(default=None)
    solver_move_san: str | None = Field(default=None)
    solver_line: list[str] | None = Field(default=None)
    coaching_stage: int | None = Field(default=None, ge=1, le=5)
    user_message: str = Field(min_length=1, max_length=2000)
    requested_mode: Literal["hint", "explain", "theme", "followup"]
    conversation_mode: (
        Literal["coach", "rival", "grandmaster", "club_friend", "minimal"] | None
    ) = Field(default=None)
    client_puzzle_history: list[dict] | None = Field(default=None)


class AssistantResponse(BaseModel):
    response_text: str
    mode: Literal["hint", "explain", "theme", "followup"]
    theme_tags: list[str]
    confidence: float
    referenced_move: str | None
    guardrail_triggered: bool
    guardrail_reason: str | None = None


def _parse_submitted_at(value: object) -> datetime:
    if not isinstance(value, str) or not value.strip():
        return datetime.min
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = f"{candidate[:-1]}+00:00"
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return datetime.min


def _normalize_client_history_context(
    history: list[dict] | None,
    *,
    max_items: int = 200,
) -> list[dict]:
    if not isinstance(history, list):
        return []

    normalized: list[dict] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        has_puzzle_image_raw = item.get("hasPuzzleImage")
        has_puzzle_image = (
            bool(has_puzzle_image_raw)
            if isinstance(has_puzzle_image_raw, bool)
            else isinstance(item.get("originalPuzzleImageDataUrl"), str)
            and bool(str(item.get("originalPuzzleImageDataUrl")).strip())
        )
        normalized_item = {
            "id": item.get("id"),
            "fileName": item.get("fileName"),
            "submittedAt": item.get("submittedAt"),
            "fen": item.get("fen"),
            "solveTimeMs": item.get("solveTimeMs"),
            "puzzleElo": item.get("puzzleElo"),
            "difficultyRating": item.get("difficultyRating"),
            "estimatedDifficultyRating": item.get("estimatedDifficultyRating"),
            "mateIn": item.get("mateIn"),
            "visionConfidence": item.get("visionConfidence"),
            "attemptsUsed": item.get("attemptsUsed"),
            "firstMoveCorrect": item.get("firstMoveCorrect"),
            "firstMoveStatus": item.get("firstMoveStatus"),
            "timeToFirstMoveSeconds": item.get("timeToFirstMoveSeconds"),
            "puzzleId": item.get("puzzleId"),
            "hasPuzzleImage": has_puzzle_image,
            "solutionLines": item.get("solutionLines"),
        }
        normalized.append(normalized_item)

    normalized.sort(
        key=lambda entry: _parse_submitted_at(entry.get("submittedAt")),
        reverse=True,
    )
    return normalized[:max_items]


@router.post("/assistant", response_model=AssistantResponse)
async def assistant(
    payload: AssistantRequest,
    current_user: dict | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
    local_auth_user: LocalAuthUser | None = Depends(get_optional_local_auth_user),
):
    history_context: list[dict] | None = None
    client_history_context = _normalize_client_history_context(
        payload.client_puzzle_history
    )
    user_profile_context: dict | None = None
    if current_user is None and local_auth_user is None:
        raise HTTPException(status_code=401, detail="Authentication is required.")

    if local_auth_user is not None:
        try:
            history_context = build_submission_history_context_for_user(
                db=db,
                current_user=local_auth_user,
                limit=200,
            )
        except Exception as exc:
            logger.warning("assistant history lookup failed: %s", exc)
            history_context = None

    merged_history_context: list[dict] | None = None
    if history_context and client_history_context:
        merged_history_context = _normalize_client_history_context(
            [*client_history_context, *history_context]
        )
    elif history_context:
        merged_history_context = history_context
    elif client_history_context:
        merged_history_context = client_history_context

    user_profile_context = build_agent_user_profile_context(
        local_auth_user=local_auth_user,
        auth_profile=current_user,
    )

    user_id = ""
    if isinstance(current_user, dict):
        candidate_sub = current_user.get("sub")
        if isinstance(candidate_sub, str):
            user_id = candidate_sub
    if not user_id and local_auth_user is not None:
        user_id = str(local_auth_user.id)

    result = assistant_agent.run(
        user_id=user_id,
        puzzle_id=payload.puzzle_id,
        fen=payload.fen,
        solver_move_san=payload.solver_move_san,
        solver_line=payload.solver_line,
        coaching_stage=payload.coaching_stage,
        user_message=payload.user_message,
        requested_mode=payload.requested_mode,
        conversation_mode=payload.conversation_mode,
        user_puzzle_history=merged_history_context,
        user_profile_context=user_profile_context,
    )

    return AssistantResponse(
        response_text=result.get("response_text", ""),
        mode=payload.requested_mode,
        theme_tags=result.get("theme_tags", []),
        confidence=float(result.get("confidence", 0.0)),
        referenced_move=result.get("referenced_move"),
        guardrail_triggered=bool(result.get("guardrail_triggered", False)),
        guardrail_reason=result.get("guardrail_reason"),
    )
