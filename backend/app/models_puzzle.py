from datetime import datetime
import uuid

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID

from app.models_auth import Base


class LocalAuthPuzzleSubmission(Base):
    __tablename__ = "local_auth_puzzle_submissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("local_auth_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_name = Column(Text, nullable=False)
    expected_side_to_move = Column(Text, nullable=True)
    fen = Column(Text, nullable=True)
    solve_time_ms = Column(Integer, nullable=True)
    puzzle_elo = Column(Integer, nullable=True)
    difficulty_rating = Column(Integer, nullable=True)
    estimated_difficulty_rating = Column(Integer, nullable=True)
    position_check = Column(JSON, nullable=True)
    solution_lines = Column(JSON, nullable=False, default=list)
    first_move_assessment = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
