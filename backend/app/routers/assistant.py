from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth0 import get_current_user
from app.db_auth import get_db
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
    conversation_mode: Literal[
        "coach", "rival", "grandmaster", "club_friend", "minimal"
    ] | None = Field(default=None)


class AssistantResponse(BaseModel):
    response_text: str
    mode: Literal["hint", "explain", "theme", "followup"]
    theme_tags: list[str]
    confidence: float
    referenced_move: str | None
    guardrail_triggered: bool
    guardrail_reason: str | None = None


@router.post("/assistant", response_model=AssistantResponse)
async def assistant(
    payload: AssistantRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_local_auth_user_id: str | None = Header(
        default=None, alias="X-Local-Auth-User-Id"
    ),
):
    history_context: list[dict] | None = None
    user_profile_context: dict | None = None
    local_auth_user: LocalAuthUser | None = None
    if isinstance(x_local_auth_user_id, str) and x_local_auth_user_id.strip():
        try:
            local_user_uuid = UUID(x_local_auth_user_id.strip())
            local_auth_user = db.get(LocalAuthUser, local_user_uuid)
        except ValueError:
            local_auth_user = None
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
    user_profile_context = build_agent_user_profile_context(
        local_auth_user=local_auth_user,
        auth_profile=current_user,
    )

    result = assistant_agent.run(
        user_id=str(current_user.get("sub", "")),
        puzzle_id=payload.puzzle_id,
        fen=payload.fen,
        solver_move_san=payload.solver_move_san,
        solver_line=payload.solver_line,
        coaching_stage=payload.coaching_stage,
        user_message=payload.user_message,
        requested_mode=payload.requested_mode,
        conversation_mode=payload.conversation_mode,
        user_puzzle_history=history_context,
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
