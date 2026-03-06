from datetime import datetime
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID

from ..base import Base


class PuzzleSubmission(Base):
    __tablename__ = "puzzle_submissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    image_url = Column(Text, nullable=False)
    original_fen = Column(Text, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)