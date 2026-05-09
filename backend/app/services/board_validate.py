from __future__ import annotations

# Compatibility shim. Canonical implementation lives in board_position_service.py.
from app.services.board_position_service import (  # noqa: F401
    CandidateBoard,
    board_map_to_fen,
    build_candidates,
    rotate_board_map_180,
)
