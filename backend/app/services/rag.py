from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from google import genai
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row

BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_PATH = BACKEND_DIR / ".env"
load_dotenv(ENV_PATH, override=True)


class EmbeddingServiceError(RuntimeError):
    """Raised when embedding generation fails."""


class RetrievalDatabaseError(RuntimeError):
    """Raised when documentation chunk retrieval fails."""


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is missing. Set it in backend/.env")
    return value


@lru_cache(maxsize=1)
def _get_database_url() -> str:
    raw_url = _require_env("DATABASE_URL")
    if raw_url.startswith("postgresql+psycopg://"):
        return "postgresql://" + raw_url[len("postgresql+psycopg://") :]
    if raw_url.startswith("postgresql+psycopg2://"):
        return "postgresql://" + raw_url[len("postgresql+psycopg2://") :]
    return raw_url


@lru_cache(maxsize=1)
def _get_genai_client() -> genai.Client:
    api_key = _require_env("GOOGLE_API_KEY")
    return genai.Client(api_key=api_key)


def embed_query(query: str) -> list[float]:
    clean_query = (query or "").strip()
    if not clean_query:
        raise ValueError("Query must not be empty.")

    try:
        client = _get_genai_client()
        response = client.models.embed_content(
            model="gemini-embedding-001",
            contents=clean_query,
        )
        return response.embeddings[0].values
    except Exception as exc:
        raise EmbeddingServiceError("Failed to create query embedding.") from exc


def retrieve_chunks(query: str, limit: int = 5) -> list[dict]:
    clean_query = (query or "").strip()
    if not clean_query:
        raise ValueError("Query must not be empty.")

    normalized_limit = max(1, int(limit))
    query_embedding = embed_query(clean_query)

    sql = """
    SELECT
      source_file,
      chunk_index,
      chunk_text,
      embedding <=> %s::vector AS distance
    FROM agent_doc_chunks
    ORDER BY distance ASC
    LIMIT %s;
    """

    try:
        with psycopg.connect(_get_database_url(), row_factory=dict_row) as conn:
            register_vector(conn)
            with conn.cursor() as cur:
                cur.execute(sql, (query_embedding, normalized_limit))
                rows = cur.fetchall()
    except psycopg.Error as exc:
        raise RetrievalDatabaseError("Failed to retrieve documentation chunks.") from exc

    return [
        {
            "source_file": row["source_file"],
            "chunk_index": row["chunk_index"],
            "chunk_text": row["chunk_text"],
            "distance": float(row["distance"]),
        }
        for row in rows
    ]
