from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth0 import get_current_user
from app.services.chess_agent import assistant_agent

router = APIRouter(tags=["assistant"])


class AssistantRequest(BaseModel):
    puzzle_id: str | None = Field(default=None)
    fen: str | None = Field(default=None)
    solver_move_san: str | None = Field(default=None)
    solver_line: list[str] | None = Field(default=None)
    user_message: str = Field(min_length=1, max_length=2000)
    requested_mode: Literal["hint", "explain", "theme", "followup"]


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
):
    result = assistant_agent.run(
        user_id=str(current_user.get("sub", "")),
        puzzle_id=payload.puzzle_id,
        fen=payload.fen,
        solver_move_san=payload.solver_move_san,
        solver_line=payload.solver_line,
        user_message=payload.user_message,
        requested_mode=payload.requested_mode,
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
