# app/db/models/user.py
from datetime import datetime
import uuid

from sqlalchemy import Column, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID

from ..base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    auth0_sub = Column(Text, unique=True, nullable=False)
    email = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


