from __future__ import annotations

import logging
import re
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db_auth import get_db
from app.models_auth import LocalAuthUser
from app.services.agent_chat import (
    AgentDatabaseError,
    GeminiServiceError,
    MAX_QUERY_LENGTH,
    MAX_RAW_QUERY_LENGTH,
    QueryValidationError,
    generate_rag_answer,
)
from app.services.rag import EmbeddingServiceError, RetrievalDatabaseError, retrieve_chunks
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


class ChatResponse(BaseModel):
    query: str
    answer: str


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
async def retrieve(request: RetrievalRequest) -> RetrievalResponse:
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
    db: Session = Depends(get_db),
    x_local_auth_user_id: str | None = Header(
        default=None, alias="X-Local-Auth-User-Id"
    ),
) -> ChatResponse:
    try:
        clean_query = _normalize_query_or_raise(request.query)
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
                logger.warning("agent_chat history lookup failed: %s", exc)
                history_context = None
            user_profile_context = build_agent_user_profile_context(
                local_auth_user=local_auth_user
            )
        rag_result = generate_rag_answer(
            clean_query,
            request.limit,
            user_puzzle_history=history_context,
            user_profile_context=user_profile_context,
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
    )
