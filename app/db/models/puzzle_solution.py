from datetime import datetime
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

from ..base import Base


class PuzzleSolution(Base):
    __tablename__ = "puzzle_solutions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id = Column(
        UUID(as_uuid=True),
        ForeignKey("puzzle_submissions.id"),
        nullable=False,
    )
    moves = Column(ARRAY(Text), nullable=True)
    final_fen = Column(Text, nullable=True)
    raw_engine_out = Column(JSONB, nullable=True)
    solve_time_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
