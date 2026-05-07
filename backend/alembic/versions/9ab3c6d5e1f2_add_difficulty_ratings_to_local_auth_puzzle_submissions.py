"""add difficulty ratings to local auth puzzle submissions

Revision ID: 9ab3c6d5e1f2
Revises: 4f2c8a21b6ef
Create Date: 2026-05-07 12:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9ab3c6d5e1f2"
down_revision: Union[str, Sequence[str], None] = "4f2c8a21b6ef"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "local_auth_puzzle_submissions",
        sa.Column("difficulty_rating", sa.Integer(), nullable=True),
    )
    op.add_column(
        "local_auth_puzzle_submissions",
        sa.Column("estimated_difficulty_rating", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("local_auth_puzzle_submissions", "estimated_difficulty_rating")
    op.drop_column("local_auth_puzzle_submissions", "difficulty_rating")
