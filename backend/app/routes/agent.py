from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.agent_chat import (
    AgentDatabaseError,
    GeminiServiceError,
    MAX_QUERY_LENGTH,
    MAX_RAW_QUERY_LENGTH,
    QueryValidationError,
    generate_rag_answer,
)
from app.services.rag import EmbeddingServiceError, RetrievalDatabaseError, retrieve_chunks

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
async def chat(request: ChatRequest) -> ChatResponse:
    try:
        clean_query = _normalize_query_or_raise(request.query)
        rag_result = generate_rag_answer(clean_query, request.limit)
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
