import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from google import genai

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
DOCS_DIR = PROJECT_ROOT / "docs"

load_dotenv(BACKEND_DIR / ".env", override=True)


def chunk_text(text: str, max_chars: int = 1200, overlap: int = 200):
    chunks = []
    start = 0

    while start < len(text):
        end = start + max_chars
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        start = end - overlap

    return chunks


def embed_text(client: genai.Client, text: str):
    response = client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
    )
    return response.embeddings[0].values


def main():
    google_api_key = os.getenv("GOOGLE_API_KEY")
    database_url = os.getenv("DATABASE_URL")

    if not google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is missing. Check backend/.env")
    if not database_url:
        raise RuntimeError("DATABASE_URL is missing. Check backend/.env")

    client = genai.Client(api_key=google_api_key)
    markdown_files = list(DOCS_DIR.glob("*.md"))

    print(f"Docs directory: {DOCS_DIR}")
    print(f"Found {len(markdown_files)} markdown files")

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_doc_chunks (
                    id SERIAL PRIMARY KEY,
                    source_file TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    chunk_text TEXT NOT NULL,
                    embedding vector(3072),
                    created_at TIMESTAMP DEFAULT NOW()
                );
                """
            )
            cur.execute("DELETE FROM agent_doc_chunks;")

            for file_path in markdown_files:
                text = file_path.read_text(encoding="utf-8")
                chunks = chunk_text(text)
                print(f"Ingesting {file_path.name}: {len(chunks)} chunks")

                for index, chunk in enumerate(chunks):
                    embedding = embed_text(client, chunk)
                    cur.execute(
                        """
                        INSERT INTO agent_doc_chunks
                        (source_file, chunk_index, chunk_text, embedding)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (file_path.name, index, chunk, embedding),
                    )

        conn.commit()

    print("Done ingesting docs.")


if __name__ == "__main__":
    main()
