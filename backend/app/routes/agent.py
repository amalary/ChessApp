from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth0 import get_current_user, get_optional_current_user
from app.db_auth import get_db
from app.local_auth_user import (
    get_optional_local_auth_user,
    get_optional_local_auth_user_from_current_user,
)
from app.models_auth import LocalAuthUser
from app.services.agent_chat import (
    AgentDatabaseError,
    GeminiServiceError,
    MAX_QUERY_LENGTH,
    MAX_RAW_QUERY_LENGTH,
    QueryValidationError,
    generate_rag_answer,
)
from app.services.rag import (
    EmbeddingServiceError,
    RetrievalDatabaseError,
    retrieve_chunks,
)
from app.services.puzzle_submission_service import (
    build_submission_history_context_for_user,
)
from app.services.user_context import build_agent_user_profile_context

router = APIRouter(tags=["agent"])
logger = logging.getLogger(__name__)
WHITESPACE_PATTERN = re.compile(r"\s+")


class RetrievalRequest(BaseModel):
    query: str
    limit: int = Field(default=5, ge=1)


class RetrievalResult(BaseModel):
    source_file: str
    chunk_index: int
    chunk_text: str
    distance: float


class RetrievalResponse(BaseModel):
    query: str
    results: list[RetrievalResult]


class ChatRequest(BaseModel):
    query: str
    limit: int = Field(default=5, ge=1)
    conversation_history: list[dict] | None = Field(default=None)
    client_puzzle_history: list[dict] | None = Field(default=None)
    active_referenced_puzzle_id: str | None = Field(default=None)
    conversation_mode: (
        Literal["coach", "rival", "grandmaster", "club_friend", "minimal"] | None
    ) = Field(default=None)


class ChatResponse(BaseModel):
    query: str
    answer: str
    referenced_puzzle_id: str | None = None
    referenced_puzzle_submitted_at: str | None = None
    referenced_puzzle_file_name: str | None = None


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
    max_items: int = 500,
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
    deduped: list[dict] = []
    key_to_index: dict[str, int] = {}

    def build_entry_keys(entry: dict) -> list[str]:
        keys: list[str] = []
        entry_id = entry.get("id")
        if isinstance(entry_id, str) and entry_id.strip():
            keys.append(f"id::{entry_id.strip()}")

        submitted_at = str(entry.get("submittedAt") or "").strip()
        file_name = str(entry.get("fileName") or "").strip().lower()
        fen = str(entry.get("fen") or "").strip()
        puzzle_id = str(entry.get("puzzleId") or "").strip()
        mate_in = str(entry.get("mateIn") or "").strip()
        first_solution = ""
        solution_lines = entry.get("solutionLines")
        if isinstance(solution_lines, list) and solution_lines:
            first_line = solution_lines[0]
            if isinstance(first_line, str):
                first_solution = first_line.strip()
        # Signature key intentionally ignores submission id so the same solved puzzle
        # from client cache and backend history can collapse to one unique entry.
        keys.append(
            f"signature::{file_name}::{fen}::{puzzle_id}::{mate_in}::{first_solution}"
        )
        keys.append(f"fallback::{submitted_at}::{file_name}::{fen}::{first_solution}")
        return keys

    for entry in normalized:
        entry_keys = build_entry_keys(entry)
        matched_index = next(
            (key_to_index[key] for key in entry_keys if key in key_to_index),
            None,
        )

        if matched_index is None:
            deduped.append(entry)
            index = len(deduped) - 1
            for key in entry_keys:
                key_to_index[key] = index
            if len(deduped) >= max_items:
                break
            continue

        existing = deduped[matched_index]
        existing_has_image = bool(existing.get("hasPuzzleImage"))
        candidate_has_image = bool(entry.get("hasPuzzleImage"))
        if candidate_has_image and not existing_has_image:
            deduped[matched_index] = entry
            for key in entry_keys:
                key_to_index[key] = matched_index

    return deduped


def _normalize_query_or_raise(query: str) -> str:
    raw_query = (query or "")[:MAX_RAW_QUERY_LENGTH]
    clean_query = WHITESPACE_PATTERN.sub(" ", raw_query).strip()
    if not clean_query:
        raise QueryValidationError("Query must not be empty.")
    if len(clean_query) > MAX_QUERY_LENGTH:
        raise QueryValidationError(
            f"Query must be at most {MAX_QUERY_LENGTH} characters."
        )
    return clean_query


@router.post("/retrieve", response_model=RetrievalResponse)
async def retrieve(
    request: RetrievalRequest,
    current_user: dict = Depends(get_current_user),
) -> RetrievalResponse:
    try:
        clean_query = _normalize_query_or_raise(request.query)
        logger.info("agent_retrieve query_len=%d", len(clean_query))
        results = retrieve_chunks(clean_query, request.limit)
        logger.info("agent_retrieve retrieval_count=%d", len(results))
    except QueryValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_query", "message": str(exc)},
        ) from exc
    except RetrievalDatabaseError as exc:
        raise HTTPException(
            status_code=500,
            detail={"code": "database_error", "message": str(exc)},
        ) from exc
    except EmbeddingServiceError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "gemini_embedding_error", "message": str(exc)},
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "retrieval_error",
                "message": "Failed to retrieve chunks.",
            },
        ) from exc

    return RetrievalResponse(query=clean_query, results=results)


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: dict | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
    local_auth_user: LocalAuthUser | None = Depends(get_optional_local_auth_user),
) -> ChatResponse:
    try:
        clean_query = _normalize_query_or_raise(request.query)
        history_context: list[dict] | None = None
        client_history_context = _normalize_client_history_context(
            request.client_puzzle_history
        )
        user_profile_context: dict | None = None
        if local_auth_user is None:
            local_auth_user = get_optional_local_auth_user_from_current_user(
                current_user=current_user,
                db=db,
            )
        if local_auth_user is not None:
            try:
                history_context = build_submission_history_context_for_user(
                    db=db,
                    current_user=local_auth_user,
                    limit=500,
                )
            except Exception as exc:
                logger.warning("agent_chat history lookup failed: %s", exc)
                history_context = None
            user_profile_context = build_agent_user_profile_context(
                local_auth_user=local_auth_user,
                auth_profile=current_user,
            )
        elif current_user is not None:
            user_profile_context = build_agent_user_profile_context(
                auth_profile=current_user,
            )

        merged_history_context: list[dict] | None = None
        if history_context and client_history_context:
            merged_history_context = _normalize_client_history_context(
                [*client_history_context, *history_context]
            )
        elif history_context:
            merged_history_context = history_context
        elif client_history_context:
            merged_history_context = client_history_context

        rag_result = generate_rag_answer(
            clean_query,
            request.limit,
            user_puzzle_history=merged_history_context,
            user_profile_context=user_profile_context,
            conversation_history=request.conversation_history,
            conversation_mode=request.conversation_mode,
            active_referenced_puzzle_id=request.active_referenced_puzzle_id,
        )
    except QueryValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_query", "message": str(exc)},
        ) from exc
    except AgentDatabaseError as exc:
        raise HTTPException(
            status_code=500,
            detail={"code": "database_error", "message": str(exc)},
        ) from exc
    except GeminiServiceError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "gemini_api_error", "message": str(exc)},
        ) from exc
    except Exception as exc:
        logger.exception("agent_chat unhandled error: %s", exc)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "chat_generation_error",
                "message": "Failed to generate answer.",
            },
        ) from exc

    return ChatResponse(
        query=clean_query,
        answer=rag_result["answer"],
        referenced_puzzle_id=rag_result.get("referenced_puzzle_id"),
        referenced_puzzle_submitted_at=rag_result.get("referenced_puzzle_submitted_at"),
        referenced_puzzle_file_name=rag_result.get("referenced_puzzle_file_name"),
    )
