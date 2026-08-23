#!/usr/bin/env python3
"""Assemble `assets/icons/` from the generated icon art.

    npm run icons          (needs Python 3 with Pillow)

The art lives in `output/imagegen/claude-monitor`: image-gen masters plus the cut,
alpha-correct tiles that `refine-cutout.py` renders from them. This script does not
draw anything -- it maps that art onto the app's own status names and writes what the
runtime loads:

    app.ico            the exe and window icon (electron-builder reads this)
    app.png            window icon in dev, where there is no exe to take it from
    app-<status>.png    toast logo, per notifying status (F5)

The tray tiles are NOT here any more. They used to be generated from the same art, one
PNG per state per physical tray size, plus a second set treated for a light taskbar --
36 + 36 files derived from a rounded near-black plate with a glowing ring on it. At the
size the tray actually shows (16 px at 100 % display scaling) the plate ate the box and
the state went with it. They are now drawn in code by `src/main/tray-icons.ts`, at the
exact pixel size Windows asks for, in the same status colours the rest of the app uses
for the same state -- so there is nothing to generate, nothing to resample, and one
place where a status colour lives.
"""

from __future__ import annotations

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

# Toast logos, one per notifying status (NOTIFYING_STATUSES).
TOAST_ART = {"waiting": "waiting", "done": "finished"}
APP_PNG_SIZE = 256

# Folders earlier versions of this script wrote. Leaving them behind would ship a second,
# stale icon set that nothing loads.
STALE_DIRS = ["tray", "tray-light"]


def main() -> None:
    if not ART.is_dir():
        sys.exit(f"icon art not found: {ART}")
    OUT.mkdir(parents=True, exist_ok=True)

    for name in STALE_DIRS:
        stale = OUT / name
        if stale.is_dir():
            shutil.rmtree(stale)
            print(f"removed stale {name}/ (tray tiles are drawn in code now)")

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

    print(f"\nwritten to {OUT}")


if __name__ == "__main__":
    main()
