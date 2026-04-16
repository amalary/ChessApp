from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


@dataclass
class PreprocessedImage:
    image: Image.Image
    width: int
    height: int


def preprocess_image_bytes(image_bytes: bytes) -> PreprocessedImage:
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    img = ImageOps.autocontrast(img, cutoff=1)
    img = ImageEnhance.Sharpness(img).enhance(1.2)
    img = ImageEnhance.Contrast(img).enhance(1.12)
    img = img.filter(ImageFilter.MedianFilter(size=3))
    return PreprocessedImage(image=img, width=img.width, height=img.height)

