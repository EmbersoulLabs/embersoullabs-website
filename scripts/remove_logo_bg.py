"""Remove near-black background from original logo photos."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = Path(__file__).resolve().parents[1] / "assets"

SOURCES = {
    "logo-horizontal.png": ROOT / "IMG_20260619_202353.png",
    "logo-stacked.png": ROOT / "IMG_20260619_202318.png",
    "logo-icon.png": ROOT / "IMG_20260619_202602.png",
}


def remove_black_bg(
    src: Path,
    dst: Path,
    *,
    threshold: int = 42,
    softness: int = 38,
    pad: int = 6,
) -> None:
    im = Image.open(src).convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    peak = np.maximum(np.maximum(r, g), b)
    alpha = np.clip((peak - threshold) * (255.0 / softness), 0, 255)
    black = (r < 18) & (g < 18) & (b < 18)
    alpha[black] = 0
    arr[..., 3] = alpha
    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    bbox = out.getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(out.width, x1 + pad)
        y1 = min(out.height, y1 + pad)
        out = out.crop((x0, y0, x1, y1))
    out.save(dst, "PNG")
    print(f"{src.name} -> {dst.name} ({out.width}x{out.height})")


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    for name, src in SOURCES.items():
        kw = {"threshold": 50, "softness": 28} if "icon" in name else {}
        remove_black_bg(src, ASSETS / name, **kw)
    icon = Image.open(ASSETS / "logo-icon.png")
    fav = icon.resize(
        (180, int(180 * icon.height / icon.width)),
        Image.Resampling.LANCZOS,
    )
    fav.save(ASSETS / "favicon.png", "PNG")
    print("favicon.png written")


if __name__ == "__main__":
    main()
