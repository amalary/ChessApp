from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

FILES = "abcdefgh"
RANKS = "87654321"
SQUARES = [f"{f}{r}" for r in RANKS for f in FILES]

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
class SquarePrediction:
    piece: str
    confidence: float
    alternatives: List[Tuple[str, float]]


@dataclass
class TranscriptionResult:
    board_map: Dict[str, str]
    square_predictions: Dict[str, SquarePrediction]
    uncertain_squares: List[str]
    confidence: float
    notes: str


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("seguisym.ttf", "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


def _render_templates(size: int = 96) -> Dict[str, Image.Image]:
    font = _load_font(int(size * 0.88))
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
        out[piece] = canvas.point(lambda p: 255 if p > 20 else 0)
    return out


_TEMPLATES = _render_templates()


def _foreground_ratio(mask: Image.Image) -> float:
    total = max(1, mask.width * mask.height)
    active = sum(1 for p in mask.getdata() if p > 0)
    return active / total


def _mean_fg_intensity(gray: Image.Image, mask: Image.Image) -> float:
    gp = list(gray.getdata())
    mp = list(mask.getdata())
    vals = [gp[i] for i, m in enumerate(mp) if m > 0]
    if not vals:
        return 255.0
    return sum(vals) / len(vals)


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
    canvas.paste(piece, ((out_size - nw) // 2, (out_size - nh) // 2))
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


def _empty_background(tile: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(tile)
    return gray.filter(ImageFilter.GaussianBlur(radius=2))


def _tile_mask(tile: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(tile)
    bg = _empty_background(tile)
    diff = ImageChops.difference(gray, bg)
    diff = ImageOps.autocontrast(diff, cutoff=2)
    mask = diff.point(lambda p: 255 if p > 26 else 0)
    return mask.filter(ImageFilter.MedianFilter(size=3))


def transcribe_board_from_squares(square_images: Dict[str, Image.Image]) -> TranscriptionResult:
    board_map: Dict[str, str] = {sq: "." for sq in SQUARES}
    predictions: Dict[str, SquarePrediction] = {}
    uncertain: List[str] = []
    conf_values: List[float] = []

    for square in SQUARES:
        tile = square_images[square]
        mask = _tile_mask(tile)
        fg_ratio = _foreground_ratio(mask)

        if fg_ratio < 0.055:
            pred = SquarePrediction(piece=".", confidence=0.92, alternatives=[(".", 0.92)])
            predictions[square] = pred
            board_map[square] = "."
            conf_values.append(pred.confidence)
            continue

        gray = ImageOps.grayscale(tile)
        mean_fg = _mean_fg_intensity(gray, mask)
        black_piece = mean_fg < 145.0
        norm = _normalize_mask(mask, out_size=96)

        scored: List[Tuple[str, float]] = []
        for piece, tmpl in _TEMPLATES.items():
            if black_piece and not piece.islower():
                continue
            if (not black_piece) and not piece.isupper():
                continue
            scored.append((piece, _iou(norm, tmpl)))
        scored.sort(key=lambda x: x[1], reverse=True)

        if not scored:
            pred = SquarePrediction(piece=".", confidence=0.15, alternatives=[(".", 0.15)])
            predictions[square] = pred
            board_map[square] = "."
            uncertain.append(square)
            conf_values.append(pred.confidence)
            continue

        piece, score = scored[0]
        conf = max(0.05, min(0.98, score))
        if conf < 0.22:
            uncertain.append(square)
        if conf < 0.12:
            piece = "."

        alts = scored[:3]
        pred = SquarePrediction(piece=piece, confidence=conf, alternatives=alts)
        predictions[square] = pred
        board_map[square] = piece
        conf_values.append(conf)

    avg_conf = sum(conf_values) / max(1, len(conf_values))
    return TranscriptionResult(
        board_map=board_map,
        square_predictions=predictions,
        uncertain_squares=sorted(set(uncertain)),
        confidence=max(0.0, min(1.0, avg_conf)),
        notes="square_template_baseline",
    )

