from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

from PIL import Image

FILES = "abcdefgh"
RANKS = "87654321"
SQUARES = [f"{f}{r}" for r in RANKS for f in FILES]


@dataclass
class SquareExtractionResult:
    square_images: Dict[str, Image.Image]
    board_size: int


def extract_square_images(board_image: Image.Image) -> SquareExtractionResult:
    sq = board_image.width // 8
    out: Dict[str, Image.Image] = {}
    for rank_idx, rank in enumerate(RANKS):
        for file_idx, file in enumerate(FILES):
            x0 = file_idx * sq
            y0 = rank_idx * sq
            out[f"{file}{rank}"] = board_image.crop((x0, y0, x0 + sq, y0 + sq))
    return SquareExtractionResult(square_images=out, board_size=board_image.width)

