from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from app.services.board_validate import CandidateBoard
from app.services.mate_solver import MateLine

VALIDATION_BONUS = 1.0
MATE_FOUND_BONUS = 1.0
REPAIR_PENALTY = 0.05
SIDE_HINT_MATCH_BONUS = 0.1
SIDE_HINT_MISMATCH_PENALTY = 0.05


@dataclass
class RankedCandidate:
    candidate: CandidateBoard
    mate_line: Optional[MateLine]
    score: float


def _hint_bonus(side_hint: str | None, candidate: CandidateBoard) -> float:
    if not side_hint:
        return 0.0
    candidate_side = (candidate.side_to_move or "").strip().lower()
    if not candidate_side:
        return 0.0
    if side_hint.lower().startswith(candidate_side[0]):
        return SIDE_HINT_MATCH_BONUS
    return -SIDE_HINT_MISMATCH_PENALTY


def _mate_bonus(mate: Optional[MateLine]) -> float:
    if mate is None:
        return 0.0
    return MATE_FOUND_BONUS + (0.4 - (mate.mate_in * 0.08))


def _candidate_score(
    candidate: CandidateBoard, mate: Optional[MateLine], side_hint: str | None
) -> float:
    score = 0.0
    if candidate.validation.passed:
        score += VALIDATION_BONUS
    score += max(0.0, min(1.0, candidate.confidence))
    if candidate.repair_applied:
        score -= REPAIR_PENALTY
    score += _hint_bonus(side_hint, candidate)
    score += _mate_bonus(mate)
    return score


def rank_candidates(
    candidates: Iterable[CandidateBoard],
    mate_by_fen: dict[str, Optional[MateLine]],
    side_hint: str | None = None,
) -> list[RankedCandidate]:
    ranked: list[RankedCandidate] = []
    for c in candidates:
        mate = mate_by_fen.get(c.fen)
        score = _candidate_score(c, mate, side_hint)
        ranked.append(RankedCandidate(candidate=c, mate_line=mate, score=score))
    return sorted(ranked, key=lambda r: r.score, reverse=True)
