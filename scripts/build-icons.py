#!/usr/bin/env python3
"""Assemble `assets/icons/` from the generated icon art.

    npm run icons          (needs Python 3 with Pillow)

The art lives in `output/imagegen/claude-monitor`: image-gen masters plus the cut,
alpha-correct tiles that `refine-cutout.py` renders from them. This script does not
draw anything -- it maps that art onto the app's own state names, derives the one
state the art set has no tile for, and writes exactly what the runtime loads:

    app.ico            the exe and window icon (electron-builder reads this)
    app.png            window icon in dev, where there is no exe to take it from
    app-<status>.png    toast logo, per notifying status (F5)
    tray/<px>/<icon>.png   one tile per tray icon state, per physical tray size

Tray tiles are shipped per size rather than as one large PNG because Windows hands
the tray a fixed pixel box (16 px per 100 % of display scaling) and resamples
whatever it gets; a tile rendered at that exact size stays crisp instead.

`stale` is derived, not generated: the art set has five states and the app has six
tray icons. It reuses the `waiting` ring pushed onto the muted amber of
`STATE_COLORS.stale`, which is the same relationship the two states have
everywhere else -- same shape, quieter colour, because `stale` is a hint and
`waiting` is a demand (§6.3).
"""

from __future__ import annotations

import colorsys
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ModuleNotFoundError:  # pragma: no cover - a tooling problem, not a code path
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "output" / "imagegen" / "claude-monitor"
OUT = ROOT / "assets" / "icons"

# Tray icon state (src/core/model/status.ts) -> name of the art tile.
TRAY_ART = {
    "none": "base",
    "working": "running",
    "waiting": "waiting",
    "done": "finished",
    "mixed": "mixed",
}
# Tray icon state -> (art tile it is derived from, recolour target).
# The target is STATE_COLORS.stale from src/main/tray-icons.ts.
DERIVED = {"stale": ("waiting", (172, 142, 104))}

# 16 px per 100 % display scaling, up to 300 %.
TRAY_SIZES = [16, 20, 24, 32, 40, 48]

# Toast logos, one per notifying status (NOTIFYING_STATUSES).
TOAST_ART = {"waiting": "waiting", "done": "finished"}
APP_PNG_SIZE = 256

# Saturation of the `waiting` ring in the art, measured on the 256 px tiles. The
# recolour scales saturation by target/source rather than replacing it, so the
# ring's own falloff into the glow survives.
RING_SATURATION = 0.92
# The glyph sits inside 0.30 r and the ring outside it. Recolouring by hue alone
# would catch the glyph too -- it is orange, and so is the ring.
GLYPH_RADIUS = 0.30
# Below this saturation a pixel is tile or glow-on-tile, and re-hueing it would
# only introduce a colour cast.
NEUTRAL_SATURATION = 0.12
# The ring is dimmed as well as desaturated: `stale` should read as the quieter of
# the two overdue states at a glance, not just as a different colour.
RING_DIM = 0.86


def tray_tile(art: str, size: int) -> Image.Image:
    return Image.open(ART / "tray" / f"{size}x{size}" / f"claude-monitor-tray-{art}.png").convert("RGBA")


def recolor_ring(tile: Image.Image, target: tuple[int, int, int]) -> Image.Image:
    """Move the ring of a tray tile onto `target`'s hue and saturation."""
    hue, saturation, _ = colorsys.rgb_to_hsv(*(c / 255 for c in target))
    size = tile.width
    centre = (size - 1) / 2
    inner = GLYPH_RADIUS * size
    src = tile.load()
    out = tile.copy()
    dst = out.load()

    for y in range(size):
        for x in range(size):
            if (x - centre) ** 2 + (y - centre) ** 2 < inner * inner:
                continue
            r, g, b, a = src[x, y]
            _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s < NEUTRAL_SATURATION:
                continue
            nr, ng, nb = colorsys.hsv_to_rgb(
                hue, min(1.0, s * saturation / RING_SATURATION), v * RING_DIM
            )
            dst[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return out


def main() -> None:
    if not ART.is_dir():
        sys.exit(f"icon art not found: {ART}")
    OUT.mkdir(parents=True, exist_ok=True)

    # The tray tiles used to be drawn in code and written straight into this folder;
    # leaving them behind would ship two icon sets.
    for old in list(OUT.glob("tray-*.png")):
        old.unlink()

    shutil.copyfile(ART / "app" / "claude-monitor-base.ico", OUT / "app.ico")
    base = Image.open(ART / "app" / "claude-monitor-base.png").convert("RGBA")
    base.resize((APP_PNG_SIZE, APP_PNG_SIZE), Image.Resampling.LANCZOS).save(OUT / "app.png", optimize=True)
    print(f"app.ico, app.png ({APP_PNG_SIZE} px)")

    for status, art in TOAST_ART.items():
        src = Image.open(ART / "app" / f"claude-monitor-{art}.png").convert("RGBA")
        src.resize((APP_PNG_SIZE, APP_PNG_SIZE), Image.Resampling.LANCZOS).save(
            OUT / f"app-{status}.png", optimize=True
        )
        print(f"app-{status}.png ({APP_PNG_SIZE} px) from {art}")

    for size in TRAY_SIZES:
        folder = OUT / "tray" / str(size)
        folder.mkdir(parents=True, exist_ok=True)
        for icon, art in TRAY_ART.items():
            tray_tile(art, size).save(folder / f"{icon}.png", optimize=True)
        for icon, (art, target) in DERIVED.items():
            recolor_ring(tray_tile(art, size), target).save(folder / f"{icon}.png", optimize=True)
        names = ", ".join(sorted([*TRAY_ART, *DERIVED]))
        print(f"tray/{size}/: {names}")

    print(f"\nwritten to {OUT}")


if __name__ == "__main__":
    main()
