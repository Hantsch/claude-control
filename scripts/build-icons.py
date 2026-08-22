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
    tray-light/<px>/<icon>.png   the same set, treated for a light taskbar

Tray tiles are shipped per size rather than as one large PNG because Windows hands
the tray a fixed pixel box (16 px per 100 % of display scaling) and resamples
whatever it gets; a tile rendered at that exact size stays crisp instead.

The art is drawn for a dark taskbar: a near-black tile carrying a bright ring.
On a light taskbar that reads as a black hole with a glowing dot in it, so the whole
set is run through `light_tile()` a second time into `tray-light/` -- ground and mark
inverted in value, the ring moved onto the light colour scheme's status colours, and
the silhouette's edge darkened so the tile still has a border (§6.3).

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

# Tray icon state -> the status colour the light colour scheme uses for it, from the
# `prefers-color-scheme: light` block in src/renderer/styles.css. The art bakes in the
# dark scheme's colours, which are too bright to survive on a light ground.
# `none` and `mixed` are absent on purpose: neither has a --status-* colour of its own,
# their mark is the neutral/brand art, and forcing it onto a status hue would invent a
# state. They keep the art's hue and are only inverted onto the light ground.
LIGHT_STATUS = {
    "waiting": (0xA0, 0x4C, 0x00),
    "done": (0x15, 0x7F, 0x3C),
    "working": (0x1B, 0x5F, 0xC9),
    "stale": (0x8F, 0x7C, 0x5F),
}
# The mark is inverted like the ground, but only down to this value instead of to 0:
# the brightest ring pixel lands here, dark enough to hold against a light taskbar.
# RING_DIM cannot be reused -- it dims a mark that has to stay visible on black, which
# is the opposite problem. This sits below the light scheme's own status colours on
# purpose: the art's ring is a glow, so its peak is a thin line and the band either
# side of it has to land somewhere readable too.
LIGHT_MARK_FLOOR = 0.32
# The art's ring spends most of its area in the mid tones. Inverting them one for one
# leaves a pastel smear, so the mark's brightness is read as ink coverage and pushed
# through this gamma first: mid tones darken, the falloff into the ground survives.
LIGHT_MARK_GAMMA = 0.55
# Width of the darkened rim, in px per 24 px of tile: one pixel at tray sizes, two once
# the tile is big enough for one to disappear.
LIGHT_RIM_RATIO = 1 / 24
# The rim is pushed this far down from the lightened ground -- enough to read as an edge
# at 16 px, not so far that the tile grows a black frame around it.
LIGHT_RIM_DIM = 0.60
# Below half opacity a pixel is the cutout's anti-aliased fringe rather than the tile,
# so the rim is measured from there and the first solid pixels carry the edge.
LIGHT_RIM_ALPHA = 128


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


def _rim_mask(tile: Image.Image) -> set[tuple[int, int]]:
    """Pixels of the silhouette that sit within `LIGHT_RIM_RATIO` of its edge."""
    size = tile.width
    reach = max(1, round(size * LIGHT_RIM_RATIO))
    src = tile.load()
    solid = [[src[x, y][3] >= LIGHT_RIM_ALPHA for x in range(size)] for y in range(size)]
    rim: set[tuple[int, int]] = set()

    for y in range(size):
        for x in range(size):
            if not solid[y][x]:
                continue
            for ny in range(y - reach, y + reach + 1):
                for nx in range(x - reach, x + reach + 1):
                    # Outside the canvas counts as outside the silhouette: the tile runs
                    # to the border, so its edge is only partly a real alpha boundary.
                    if not (0 <= nx < size and 0 <= ny < size) or not solid[ny][nx]:
                        rim.add((x, y))
                        break
                else:
                    continue
                break
    return rim


def light_tile(tile: Image.Image, target: tuple[int, int, int] | None) -> Image.Image:
    """Turn a tray tile drawn for a dark taskbar into one for a light taskbar.

    The ground is inverted (near-black becomes near-white, keeping its structure) and
    the mark is inverted with a floor, so the ring reads as dark-on-light instead of
    light-on-dark. Outside the glyph it is also moved onto `target`'s hue and
    saturation the way `recolor_ring` does it; inside `GLYPH_RADIUS` the glyph keeps
    its own colour, which is the brand's, not the status'.
    """
    hue = saturation = None
    if target is not None:
        hue, saturation, _ = colorsys.rgb_to_hsv(*(c / 255 for c in target))
    size = tile.width
    centre = (size - 1) / 2
    inner = GLYPH_RADIUS * size
    rim = _rim_mask(tile)
    src = tile.load()
    out = tile.copy()
    dst = out.load()

    for y in range(size):
        for x in range(size):
            r, g, b, a = src[x, y]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            is_mark = s >= NEUTRAL_SATURATION
            if not is_mark:
                # Tile and glow-on-tile: a straight value inversion, so the ground
                # flips to light and whatever texture it has flips with it. Its chroma
                # is dropped -- at near-black it is invisible noise, at near-white it
                # would be visible speckle.
                s = 0.0
                v = 1.0 - v
            else:
                if hue is not None and (x - centre) ** 2 + (y - centre) ** 2 >= inner * inner:
                    h = hue
                    s = min(1.0, s * saturation / RING_SATURATION)
                v = 1.0 - v**LIGHT_MARK_GAMMA * (1.0 - LIGHT_MARK_FLOOR)
            if (x, y) in rim and not is_mark:
                # Only the ground gets the rim's extra darkening. A mark pixel already went
                # through its own floor/gamma treatment above; stacking the rim's dimming on
                # top of that too pulls a ring that happens to touch the tile's edge closer to
                # the next state's ring than the dark set ever gets (§014 D3 caught this at
                # 16px, the smallest tile: `none` and `stale` fell to a tighter gap than the
                # shipped dark set's own worst pair, the one parity bar this has to clear).
                v *= LIGHT_RIM_DIM
            nr, ng, nb = colorsys.hsv_to_rgb(h, s, v)
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

        # The light set is the dark art run through one extra pass. `stale` is derived
        # from the `waiting` art here too -- the same relationship as above, folded into
        # the single light recolour instead of stacking two of them.
        light = OUT / "tray-light" / str(size)
        light.mkdir(parents=True, exist_ok=True)
        for icon, art in [*TRAY_ART.items(), *((i, a) for i, (a, _) in DERIVED.items())]:
            light_tile(tray_tile(art, size), LIGHT_STATUS.get(icon)).save(
                light / f"{icon}.png", optimize=True
            )
        print(f"tray-light/{size}/: {names}")

    print(f"\nwritten to {OUT}")


if __name__ == "__main__":
    main()
