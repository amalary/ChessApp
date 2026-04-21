from datetime import datetime
import uuid

from sqlalchemy import Column, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class LocalAuthUser(Base):
    __tablename__ = "local_auth_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(Text, unique=True, nullable=False)
    email = Column(Text, unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
