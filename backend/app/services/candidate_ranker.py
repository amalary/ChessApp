from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from app.services.board_validate import CandidateBoard
from app.services.mate_solver import MateLine


@dataclass
class RankedCandidate:
    candidate: CandidateBoard
    mate_line: Optional[MateLine]
    score: float


def _hint_bonus(side_hint: str | None, candidate: CandidateBoard) -> float:
    if not side_hint:
        return 0.0
    if side_hint.lower().startswith(candidate.side_to_move[0].lower()):
        return 0.1
    return -0.05


def rank_candidates(
    candidates: Iterable[CandidateBoard],
    mate_by_fen: dict[str, Optional[MateLine]],
    side_hint: str | None = None,
) -> list[RankedCandidate]:
    ranked: list[RankedCandidate] = []
    for c in candidates:
        mate = mate_by_fen.get(c.fen)
        score = 0.0
        if c.validation.passed:
            score += 1.0
        score += max(0.0, min(1.0, c.confidence))
        if c.repair_applied:
            score -= 0.05
        score += _hint_bonus(side_hint, c)
        if mate is not None:
            score += 1.0
            score += (0.4 - (mate.mate_in * 0.08))
        ranked.append(RankedCandidate(candidate=c, mate_line=mate, score=score))
    return sorted(ranked, key=lambda r: r.score, reverse=True)

