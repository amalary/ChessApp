from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Dict, List, Tuple

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps, ImageStat

FILES = "abcdefgh"
RANKS = "87654321"
SQUARES = [f"{file}{rank}" for rank in RANKS for file in FILES]

PIECE_SYMBOLS = {
    "K": "\u2654",
    "Q": "\u2655",
    "R": "\u2656",
    "B": "\u2657",
    "N": "\u2658",
    "P": "\u2659",
    "k": "\u265A",
    "q": "\u265B",
    "r": "\u265C",
    "b": "\u265D",
    "n": "\u265E",
    "p": "\u265F",
}


@dataclass
class LocalClassification:
    board_map: Dict[str, str]
    confidence: float
    unknown_squares: List[str]


def _load_chess_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    # Windows + fallback candidates.
    for name in (
        "seguisym.ttf",
        "segoeui.ttf",
        "arial.ttf",
    ):
        try:
            return ImageFont.truetype(name, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


def _render_template_masks(size: int = 96) -> Dict[str, Image.Image]:
    font = _load_chess_font(int(size * 0.88))
    out: Dict[str, Image.Image] = {}
    for piece, glyph in PIECE_SYMBOLS.items():
        canvas = Image.new("L", (size, size), 0)
        draw = ImageDraw.Draw(canvas)
        bbox = draw.textbbox((0, 0), glyph, font=font)
        tw = max(1, bbox[2] - bbox[0])
        th = max(1, bbox[3] - bbox[1])
        x = (size - tw) // 2 - bbox[0]
        y = (size - th) // 2 - bbox[1]
        draw.text((x, y), glyph, fill=255, font=font)
        mask = canvas.point(lambda p: 255 if p > 20 else 0)
        out[piece] = mask
    return out


_TEMPLATES = _render_template_masks()


def _count_nonzero(mask: Image.Image) -> int:
    return sum(1 for p in mask.getdata() if p > 0)


def _foreground_ratio(mask: Image.Image) -> float:
    total = max(1, mask.width * mask.height)
    return _count_nonzero(mask) / total


def _mean_on_mask(gray: Image.Image, mask: Image.Image) -> float:
    pixels = list(gray.getdata())
    m = list(mask.getdata())
    vals = [pixels[i] for i, mv in enumerate(m) if mv > 0]
    if not vals:
        return 255.0
    return float(sum(vals) / len(vals))


def _find_board_square(img: Image.Image) -> Image.Image:
    normalized = ImageOps.autocontrast(img.convert("RGB"), cutoff=1)
    gray = ImageOps.grayscale(normalized)
    inv = ImageOps.invert(gray)
    bbox = inv.getbbox()
    if bbox is None:
        return normalized
    cropped = normalized.crop(bbox)
    side = min(cropped.width, cropped.height)
    left = max(0, (cropped.width - side) // 2)
    top = max(0, (cropped.height - side) // 2)
    board = cropped.crop((left, top, left + side, top + side))
    return board.resize((1024, 1024), Image.Resampling.LANCZOS)


def _split_tiles(board: Image.Image) -> Dict[str, Image.Image]:
    sq = board.width // 8
    tiles: Dict[str, Image.Image] = {}
    for rank_idx, rank in enumerate(RANKS):
        for file_idx, file in enumerate(FILES):
            x0 = file_idx * sq
            y0 = rank_idx * sq
            tiles[f"{file}{rank}"] = board.crop((x0, y0, x0 + sq, y0 + sq))
    return tiles


def _parity(square: str) -> int:
    file_idx = FILES.index(square[0])
    rank_idx = "12345678".index(square[1])
    return (file_idx + rank_idx) % 2


def _estimate_background_tiles(tiles: Dict[str, Image.Image]) -> Dict[int, Image.Image]:
    by_parity: Dict[int, List[Tuple[float, Image.Image]]] = {0: [], 1: []}
    for square, tile in tiles.items():
        gray = ImageOps.grayscale(tile)
        edge = gray.filter(ImageFilter.FIND_EDGES)
        edge_mean = ImageStat.Stat(edge).mean[0]
        by_parity[_parity(square)].append((edge_mean, gray))

    backgrounds: Dict[int, Image.Image] = {}
    for par in (0, 1):
        candidates = sorted(by_parity[par], key=lambda row: row[0])
        backgrounds[par] = candidates[0][1] if candidates else Image.new("L", (128, 128), 200)
    return backgrounds


def _tile_foreground_mask(tile: Image.Image, bg_gray: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(tile)
    diff = ImageChops.difference(gray, bg_gray)
    diff = ImageEnhance.Contrast(diff).enhance(1.3)
    mask = diff.point(lambda p: 255 if p > 30 else 0)
    # Remove tiny speckles from hatch/background noise.
    mask = mask.filter(ImageFilter.MedianFilter(size=3))
    return mask


def _normalize_mask(mask: Image.Image, out_size: int = 96) -> Image.Image:
    bbox = mask.getbbox()
    if bbox is None:
        return Image.new("L", (out_size, out_size), 0)
    piece = mask.crop(bbox)
    w, h = piece.size
    if w < 2 or h < 2:
        return Image.new("L", (out_size, out_size), 0)
    scale = min((out_size - 10) / w, (out_size - 10) / h)
    nw = max(1, int(w * scale))
    nh = max(1, int(h * scale))
    piece = piece.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("L", (out_size, out_size), 0)
    x = (out_size - nw) // 2
    y = (out_size - nh) // 2
    canvas.paste(piece, (x, y))
    return canvas


def _iou(mask_a: Image.Image, mask_b: Image.Image) -> float:
    a = list(mask_a.getdata())
    b = list(mask_b.getdata())
    inter = 0
    union = 0
    for av, bv in zip(a, b):
        ab = av > 0
        bb = bv > 0
        if ab and bb:
            inter += 1
        if ab or bb:
            union += 1
    if union == 0:
        return 0.0
    return inter / union


def classify_board_map_from_image_bytes(image_bytes: bytes) -> LocalClassification | None:
    try:
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
    except Exception:
        return None

    board = _find_board_square(img)
    tiles = _split_tiles(board)
    backgrounds = _estimate_background_tiles(tiles)

    board_map: Dict[str, str] = {sq: "." for sq in SQUARES}
    unknown_squares: List[str] = []
    square_confidences: List[float] = []
    king_scores: Dict[str, List[Tuple[str, float]]] = {"K": [], "k": []}

    for square in SQUARES:
        tile = tiles[square]
        bg = backgrounds[_parity(square)]
        mask = _tile_foreground_mask(tile, bg)
        fg_ratio = _foreground_ratio(mask)

        if fg_ratio < 0.055:
            board_map[square] = "."
            square_confidences.append(0.9)
            continue

        gray = ImageOps.grayscale(tile)
        mean_fg = _mean_on_mask(gray, mask)
        is_black_piece = mean_fg < 145.0

        norm = _normalize_mask(mask, out_size=96)
        best_piece = None
        best_score = -1.0

        for piece, tmpl in _TEMPLATES.items():
            if piece == ".":
                continue
            if is_black_piece and not piece.islower():
                continue
            if (not is_black_piece) and not piece.isupper():
                continue
            score = _iou(norm, tmpl)
            if score > best_score:
                best_score = score
                best_piece = piece

        # Keep king candidates for post-fix even if low confidence.
        if is_black_piece:
            king_scores["k"].append((square, _iou(norm, _TEMPLATES["k"])))
        else:
            king_scores["K"].append((square, _iou(norm, _TEMPLATES["K"])))

        if best_piece is None or best_score < 0.12:
            board_map[square] = "."
            unknown_squares.append(square)
            square_confidences.append(0.2)
            continue

        board_map[square] = best_piece
        square_confidences.append(max(0.15, min(0.95, best_score)))
        if best_score < 0.2:
            unknown_squares.append(square)

    # Enforce kings if missing.
    if sum(1 for p in board_map.values() if p == "K") == 0 and king_scores["K"]:
        sq = max(king_scores["K"], key=lambda row: row[1])[0]
        board_map[sq] = "K"
    if sum(1 for p in board_map.values() if p == "k") == 0 and king_scores["k"]:
        sq = max(king_scores["k"], key=lambda row: row[1])[0]
        board_map[sq] = "k"

    confidence = sum(square_confidences) / max(1, len(square_confidences))
    return LocalClassification(
        board_map=board_map,
        confidence=max(0.0, min(1.0, confidence)),
        unknown_squares=sorted(set(unknown_squares)),
    )
