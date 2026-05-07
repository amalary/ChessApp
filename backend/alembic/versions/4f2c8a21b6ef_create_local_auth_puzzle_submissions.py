"""create local auth puzzle submissions

Revision ID: 4f2c8a21b6ef
Revises: 8c0d2f1ab3f7
Create Date: 2026-05-06 14:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "4f2c8a21b6ef"
down_revision: Union[str, Sequence[str], None] = "8c0d2f1ab3f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "local_auth_puzzle_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("local_auth_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("expected_side_to_move", sa.Text(), nullable=True),
        sa.Column("fen", sa.Text(), nullable=True),
        sa.Column("solve_time_ms", sa.Integer(), nullable=True),
        sa.Column("puzzle_elo", sa.Integer(), nullable=True),
        sa.Column("position_check", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("solution_lines", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "first_move_assessment",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_local_auth_puzzle_submissions_user_id",
        "local_auth_puzzle_submissions",
        ["user_id"],
    )
    op.create_index(
        "ix_local_auth_puzzle_submissions_created_at",
        "local_auth_puzzle_submissions",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_local_auth_puzzle_submissions_created_at",
        table_name="local_auth_puzzle_submissions",
    )
    op.drop_index(
        "ix_local_auth_puzzle_submissions_user_id",
        table_name="local_auth_puzzle_submissions",
    )
    op.drop_table("local_auth_puzzle_submissions")
