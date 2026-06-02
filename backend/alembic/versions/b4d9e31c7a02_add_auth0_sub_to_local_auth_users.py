"""add auth0 sub to local auth users

Revision ID: b4d9e31c7a02
Revises: 9ab3c6d5e1f2
Create Date: 2026-06-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b4d9e31c7a02"
down_revision: Union[str, Sequence[str], None] = "9ab3c6d5e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("local_auth_users", sa.Column("auth0_sub", sa.Text(), nullable=True))
    op.create_index(
        "ix_local_auth_users_auth0_sub",
        "local_auth_users",
        ["auth0_sub"],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_local_auth_users_auth0_sub", table_name="local_auth_users")
    op.drop_column("local_auth_users", "auth0_sub")
