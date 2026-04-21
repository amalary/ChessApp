"""create local auth users

Revision ID: 8c0d2f1ab3f7
Revises: 0320133d7179
Create Date: 2026-04-21 14:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "8c0d2f1ab3f7"
down_revision: Union[str, Sequence[str], None] = "0320133d7179"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "local_auth_users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.Text(), nullable=False, unique=True),
        sa.Column("email", sa.Text(), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("local_auth_users")
