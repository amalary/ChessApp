from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageOps


@dataclass
class BoardDetectionResult:
    board_image: Image.Image
    detection_confidence: float
    perspective_corrected: bool


def detect_and_normalize_board(
    image: Image.Image, out_size: int = 1024
) -> BoardDetectionResult:
    """
    Baseline board detector:
    - Finds non-background bounding box.
    - Center-crops to square.
    - Resizes to canonical board size.
    """
    gray = ImageOps.grayscale(image)
    inv = ImageOps.invert(gray)
    bbox = inv.getbbox()
    if bbox is None:
        base = image
        conf = 0.35
    else:
        base = image.crop(bbox)
        conf = 0.65

    side = min(base.width, base.height)
    left = max(0, (base.width - side) // 2)
    top = max(0, (base.height - side) // 2)
    square = base.crop((left, top, left + side, top + side))

    board = square.resize((out_size, out_size), Image.Resampling.LANCZOS)
    return BoardDetectionResult(
        board_image=board,
        detection_confidence=conf,
        perspective_corrected=False,  # placeholder for future homography stage
    )
