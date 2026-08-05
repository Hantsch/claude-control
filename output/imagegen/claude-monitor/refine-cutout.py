#!/usr/bin/env python3
"""Re-cut the generated claude-monitor icons from their masters.

The image-gen masters are flat RGB renders on a solid background (black for the
app tiles, white for the tray tiles). Keying them by colour leaves a rim of
background behind and never lands exactly on the tile outline, so instead we
measure the outline, then rebuild the alpha channel from that measurement:

  1. fit the tile silhouette as a rounded rect with superellipse corners
     (|qx/r|^m + |qy/r|^m = 1) to sub-pixel accuracy,
  2. inset the fitted outline by INSET px and crop there, so the soft
     background-contaminated edge band is discarded outright,
  3. resample that crop to a square canvas -- this also recentres the tile and
     removes the slight non-squareness of the masters,
  4. rasterise the same shape as an analytically anti-aliased mask.

Every output size is rendered straight from the master, so nothing is ever
resampled twice. Run with no arguments:  python refine-cutout.py
"""

from __future__ import annotations

import math
import struct
from io import BytesIO
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent

# Background-vs-tile luminance thresholds. The app masters sit on pure black and
# their darkest rim pixel is ~39; the tray masters sit on white over a ~20 tile.
THR_DARK_BG = 12
THR_LIGHT_BG = 140

# How far inside the fitted outline to crop. The masters carry a soft edge about
# 3 px wide where tile and background are blended; cropping past it is what
# actually removes the halo.
INSET = 3.0

APP_STATES = ["base", "running", "waiting", "finished", "mixed"]
TRAY_STATES = ["base", "running", "waiting", "finished", "mixed"]

APP_PNG_SIZE = 1024
APP_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
TRAY_PNG_SIZE = 256
TRAY_ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
TRAY_FOLDER_SIZES = [16, 20, 24, 32, 40, 48, 64]

# ---------------------------------------------------------------------------
# outline measurement
# ---------------------------------------------------------------------------


def _subpixel_scan(px, thr, inside, line):
    """First position along `line` where the silhouette starts, sub-pixel."""
    prev = None
    for pos, coord in line:
        v = px[coord]
        if inside(v):
            if prev is None:
                return float(pos), True  # clipped at the frame edge
            ppos, pv = prev
            if v != pv:
                return ppos + (thr - pv) / (v - pv) * (pos - ppos), False
            return float(pos), False
        prev = (pos, v)
    return None, False


def trace_outline(path: Path):
    """Sub-pixel silhouette samples for all four scan directions."""
    im = Image.open(path).convert("L")
    w, h = im.size
    px = im.load()

    corners = [px[1, 1], px[w - 2, 1], px[1, h - 2], px[w - 2, h - 2]]
    dark_bg = sum(corners) / 4 < 128
    thr = THR_DARK_BG if dark_bg else THR_LIGHT_BG
    inside = (lambda v: v > thr) if dark_bg else (lambda v: v < thr)

    left, right, top, bottom = {}, {}, {}, {}
    clipped = False
    for y in range(h):
        v, c = _subpixel_scan(px, thr, inside, [(x, (x, y)) for x in range(w)])
        if v is not None:
            left[y] = v
            clipped |= c
        v, c = _subpixel_scan(px, thr, inside, [(x, (x, y)) for x in range(w - 1, -1, -1)])
        if v is not None:
            right[y] = v
            clipped |= c
    for x in range(w):
        v, c = _subpixel_scan(px, thr, inside, [(y, (x, y)) for y in range(h)])
        if v is not None:
            top[x] = v
            clipped |= c
        v, c = _subpixel_scan(px, thr, inside, [(y, (x, y)) for y in range(h - 1, -1, -1)])
        if v is not None:
            bottom[x] = v
            clipped |= c
    return (w, h), dark_bg, clipped, left, right, top, bottom


def _median(vs):
    vs = sorted(vs)
    n = len(vs)
    return vs[n // 2] if n % 2 else (vs[n // 2 - 1] + vs[n // 2]) / 2


def sdf(x, y, cx, cy, hw, hh, r, m):
    """Signed distance to the rounded rect, negative inside.

    Away from the corners this is the plain rounded-rect distance; inside a
    corner quadrant the superellipse arc has no closed-form distance, so the
    point is scaled radially onto the arc. Both agree where they meet.
    """
    qx = abs(x - cx) - (hw - r)
    qy = abs(y - cy) - (hh - r)
    if qx <= 0 or qy <= 0:
        return max(qx, qy) - r
    v = (qx / r) ** m + (qy / r) ** m
    return math.hypot(qx, qy) * (1.0 - v ** (-1.0 / m))


def _rms(pts, p):
    s = 0.0
    for x, y in pts:
        d = sdf(x, y, *p)
        s += d * d
    return math.sqrt(s / len(pts))


def _descend(pts, init, steps):
    p = list(init)
    steps = list(steps)
    best = _rms(pts, p)
    for _ in range(4000):
        improved = False
        for i in range(6):
            for s in (steps[i], -steps[i]):
                t = list(p)
                t[i] += s
                if t[4] < 5 or t[4] > min(t[2], t[3]) or not (1.8 <= t[5] <= 6.0):
                    continue
                r = _rms(pts, t)
                if r < best - 1e-12:
                    best, p, improved = r, t, True
        if not improved:
            steps = [s / 2 for s in steps]
            if max(steps) < 1e-6:
                break
    return p, best


def fit_shape(path: Path):
    """Measure the tile outline. Returns (L, R, T, B, r, m, rms, diagnostics)."""
    (w, h), dark_bg, clipped, left, right, top, bottom = trace_outline(path)
    lo, hi = int(h * 0.35), int(h * 0.65)

    straight = {
        "L": [left[k] for k in range(lo, hi) if k in left],
        "R": [right[k] for k in range(lo, hi) if k in right],
        "T": [top[k] for k in range(lo, hi) if k in top],
        "B": [bottom[k] for k in range(lo, hi) if k in bottom],
    }
    L, R = _median(straight["L"]), _median(straight["R"])
    T, B = _median(straight["T"]), _median(straight["B"])
    wobble = max(max(v) - min(v) for v in straight.values()) / 2

    # Corner-arc samples: the parts of the silhouette clear of the straight runs
    # and of the frame border (a clipped sample carries no outline information).
    corner = []
    for y, x in left.items():
        if x > L + 2 and 2 < x < w - 3:
            corner.append((x, float(y)))
    for y, x in right.items():
        if x < R - 2 and 2 < x < w - 3:
            corner.append((x, float(y)))
    for x, y in top.items():
        if y > T + 2 and 2 < y < h - 3:
            corner.append((float(x), y))
    for x, y in bottom.items():
        if y < B - 2 and 2 < y < h - 3:
            corner.append((float(x), y))

    if clipped:
        # Straight runs ran off the canvas, so they pin nothing: solve the whole
        # rounded rect from the corner arcs, best of several starts.
        coarse = corner[::4]
        best = None
        for hw0, r0, m0 in ((w / 2, 205.0, 2.0), (w / 2 + 13, 220.0, 2.5), (w / 2 + 33, 260.0, 3.0)):
            p, rms = _descend(coarse, (w / 2 - 0.5, h / 2 - 0.5, hw0, hw0, r0, m0), [4, 4, 8, 8, 8, 0.4])
            if best is None or rms < best[1]:
                best = (p, rms)
        # Polish the winning basin against every sample.
        p, rms = _descend(corner, best[0], [0.5, 0.5, 0.5, 0.5, 0.5, 0.05])
        cx, cy, hw, hh, r, m = p
        L, R, T, B = cx - hw, cx + hw, cy - hh, cy + hh
    else:
        # Straight runs pin the four edges; only the corner shape is unknown.
        # Coarse sweep on a subsample to find the basin, then refine on all of it.
        cx, cy = (L + R) / 2, (T + B) / 2
        hw, hh = (R - L) / 2, (B - T) / 2
        coarse = corner[::4]
        best = None
        r = 150.0
        while r <= 480.0:
            m = 1.9
            while m <= 4.2:
                rr = _rms(coarse, (cx, cy, hw, hh, r, m))
                if best is None or rr < best[0]:
                    best = (rr, r, m)
                m += 0.1
            r += 6.0
        _, r, m = best
        step_r, step_m = 6.0, 0.1
        while step_r > 1e-4:
            best = (_rms(corner, (cx, cy, hw, hh, r, m)), r, m)
            for dr in (-step_r, 0.0, step_r):
                for dm in (-step_m, 0.0, step_m):
                    rr, mm = r + dr, m + dm
                    if rr < 5 or rr > min(hw, hh) or not (1.8 <= mm <= 6.0):
                        continue
                    e = _rms(corner, (cx, cy, hw, hh, rr, mm))
                    if e < best[0]:
                        best = (e, rr, mm)
            if best[1] == r and best[2] == m:
                step_r /= 2
                step_m /= 2
            r, m = best[1], best[2]
        rms = _rms(corner, (cx, cy, hw, hh, r, m))

    return L, R, T, B, r, m, rms, {"size": (w, h), "dark_bg": dark_bg, "clipped": clipped,
                                   "wobble": wobble, "corner_pts": len(corner)}


# ---------------------------------------------------------------------------
# mask rasterisation
# ---------------------------------------------------------------------------


def make_mask(size: int, rx: float, ry: float, m: float, subrows: int = 64) -> Image.Image:
    """Anti-aliased mask of the shape inscribed in a `size` square canvas.

    Coverage is exact in x (the shape's horizontal extent is solved in closed
    form per scanline) and sampled with `subrows` steps in y.
    """
    S = size
    half = S / 2.0
    ey = half - ry
    buf = bytearray(S * S)
    full_row = bytes([255]) * S
    inv = 1.0 / subrows

    for j in range(S):
        # Rows entirely within the straight band are solid; skip the maths.
        if abs(j + 0.5 - half) + 0.5 <= ey:
            buf[j * S:(j + 1) * S] = full_row
            continue

        direct = [0.0] * (S + 2)
        diff = [0.0] * (S + 2)
        for k in range(subrows):
            Y = j + (k + 0.5) * inv
            qy = abs(Y - half) - ey
            if qy <= 0:
                a, b = 0.0, float(S)
            elif qy >= ry:
                continue
            else:
                t = 1.0 - (qy / ry) ** m
                qx = rx * t ** (1.0 / m) if t > 0 else 0.0
                a, b = rx - qx, S - rx + qx
            if b <= a:
                continue
            i0 = int(a)
            i1 = int(b)
            if i0 == i1:
                direct[i0] += (b - a) * inv
                continue
            direct[i0] += (i0 + 1 - a) * inv
            if i1 <= S - 1:
                direct[i1] += (b - i1) * inv
            if i1 - 1 >= i0 + 1:
                diff[i0 + 1] += inv
                diff[i1] -= inv

        run = 0.0
        base = j * S
        for i in range(S):
            run += diff[i]
            c = direct[i] + run
            if c <= 0.0:
                continue
            buf[base + i] = 255 if c >= 1.0 else int(c * 255.0 + 0.5)

    return Image.frombytes("L", (S, S), bytes(buf))


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------


def unify(fits: dict[str, tuple]) -> tuple[float, float, dict[str, float]]:
    """Pick one outline for the whole state set.

    The generator wobbles the corner a little between states, which would make
    the tile visibly change shape as the icon switches. Settle on the family's
    median corner (radius kept relative to the tile width, since every state is
    normalised to the same canvas) and work out, per state, how much extra inset
    that costs -- if the shared outline reaches past a state's own art anywhere,
    the crop has to pull back by that much or background would survive there.
    """
    rel = sorted(r / (R - L) for L, R, T, B, r, m in fits.values())
    ms = sorted(m for *_, m in fits.values())
    rel_r = rel[len(rel) // 2]
    m_star = ms[len(ms) // 2]

    extra = {}
    for state, (L, R, T, B, r, m) in fits.items():
        cx, cy = (L + R) / 2, (T + B) / 2
        hw, hh = (R - L) / 2, (B - T) / 2
        ru = rel_r * (R - L)
        worst = 0.0
        # Walk the shared outline's corner arc and ask the state's own fitted
        # outline how far outside it each point lies.
        for i in range(801):
            qy = ru * i / 800.0
            t = 1.0 - (qy / ru) ** m_star
            qx = ru * t ** (1.0 / m_star) if t > 0 else 0.0
            x = cx + (hw - ru) + qx
            y = cy + (hh - ru) + qy
            worst = max(worst, sdf(x, y, cx, cy, hw, hh, r, m))
        extra[state] = worst
    return rel_r, m_star, extra


def render(master: Path, geom, size: int, inset: float = INSET) -> Image.Image:
    L, R, T, B, r, m = geom
    # Crop inside the fitted outline, discarding the blended edge band.
    Li, Ri, Ti, Bi, ri = L + inset, R - inset, T + inset, B - inset, r - inset
    w_in, h_in = Ri - Li, Bi - Ti

    src = Image.open(master).convert("RGB")
    # PIL boxes are pixel-boundary coords; our measurements are pixel centres.
    box = (Li + 0.5, Ti + 0.5, Ri + 0.5, Bi + 0.5)
    rgb = src.resize((size, size), Image.Resampling.LANCZOS, box=box)

    rx = ri * size / w_in
    ry = ri * size / h_in
    alpha = make_mask(size, rx, ry, m)

    # Outside the shape the master only holds background, which would bleed back
    # in as a halo if anything downstream resampled us without premultiplying.
    # Replace it with the tile's own rim colour instead.
    rim = rim_colour(rgb, alpha)
    solid = Image.new("RGB", (size, size), rim)
    keep = alpha.point(lambda v: 255 if v > 0 else 0)
    rgb = Image.composite(rgb, solid, keep)

    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def rim_colour(rgb: Image.Image, alpha: Image.Image):
    """Median colour of the band just inside the outline."""
    band = alpha.point(lambda v: 255 if 8 <= v <= 200 else 0)
    if not band.getbbox():
        band = alpha.point(lambda v: 255 if v > 0 else 0)
    chans = []
    for ch in rgb.split():
        h = ch.histogram(mask=band)
        total = sum(h)
        acc = 0
        for value, count in enumerate(h):
            acc += count
            if acc * 2 >= total:
                chans.append(value)
                break
        else:
            chans.append(0)
    return tuple(chans)


# ---------------------------------------------------------------------------
# ICO writing
# ---------------------------------------------------------------------------


def _png_payload(im: Image.Image) -> bytes:
    buf = BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _bmp_payload(im: Image.Image) -> bytes:
    """32bpp BI_RGB DIB entry (bottom-up BGRA plus an empty AND mask)."""
    w, h = im.size
    px = im.load()
    rows = []
    for y in range(h - 1, -1, -1):
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[x, y]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    pixels = b"".join(rows)
    mask_stride = ((w + 31) // 32) * 4
    mask = b"\x00" * (mask_stride * h)
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(pixels) + len(mask), 0, 0, 0, 0)
    return header + pixels + mask


def write_ico(path: Path, images: dict[int, Image.Image]) -> None:
    sizes = sorted(images)
    payloads = []
    for s in sizes:
        im = images[s]
        # PNG entries for the large frames, DIB for the small ones -- the widest
        # compatibility split, and what Windows icon tooling emits.
        payloads.append(_png_payload(im) if s >= 128 else _bmp_payload(im))

    offset = 6 + 16 * len(sizes)
    out = bytearray(struct.pack("<HHH", 0, 1, len(sizes)))
    for s, data in zip(sizes, payloads):
        dim = 0 if s >= 256 else s
        out += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    for data in payloads:
        out += data
    path.write_bytes(bytes(out))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def qa(im: Image.Image, label: str) -> None:
    """Report the cut-out and probe the rim for surviving background."""
    from PIL import ImageChops, ImageFilter

    a = im.getchannel("A")
    n = im.width * im.height
    hist = a.histogram()
    opaque, transp = hist[255], hist[0]

    solid = a.point(lambda v: 255 if v == 255 else 0)
    grey = im.convert("L")

    def ring(d0: int, d1: int):
        """Mean luminance of the band d0..d1 px inside the outline."""
        inner0 = solid.filter(ImageFilter.MinFilter(2 * d0 + 1)) if d0 else solid
        inner1 = solid.filter(ImageFilter.MinFilter(2 * d1 + 1))
        band = ImageChops.subtract(inner0, inner1)
        h = grey.histogram(mask=band)
        t = sum(h)
        return sum(v * c for v, c in enumerate(h)) / t if t else float("nan")

    # A surviving halo shows up as the outermost rim band drifting away from the
    # band behind it -- darker for the black-backed app art, lighter for the
    # white-backed tray art.
    r0, r1, r2 = ring(0, 2), ring(2, 5), ring(5, 9)
    print(
        f"    {label:20s} transparent={transp * 100 / n:5.1f}% opaque={opaque * 100 / n:5.1f}%"
        f" aa={100 - (transp + opaque) * 100 / n:4.1f}% corner_a={a.getpixel((0, 0))}"
        f" rim 0-2px={r0:6.2f} 2-5px={r1:6.2f} 5-9px={r2:6.2f} (drift={r0 - r1:+.2f})"
    )


def measure(master: Path):
    L, R, T, B, r, m, rms, diag = fit_shape(master)
    print(f"  {master.name}")
    print(f"    outline L={L:8.3f} R={R:8.3f} T={T:8.3f} B={B:8.3f}  w={R - L:8.3f} h={B - T:8.3f}")
    print(f"    corner  r={r:7.2f} m={m:5.3f}  fit_rms={rms:.3f}px  straight_wobble=±{diag['wobble']:.2f}px"
          f"  clipped={diag['clipped']}")
    print(f"    centre  cx={(L + R) / 2:8.3f} cy={(T + B) / 2:8.3f}  vs frame"
          f" {(diag['size'][0] - 1) / 2:.1f},{(diag['size'][1] - 1) / 2:.1f}"
          f"  -> shift dx={(L + R) / 2 - (diag['size'][0] - 1) / 2:+.2f} dy={(T + B) / 2 - (diag['size'][1] - 1) / 2:+.2f}")
    if rms > 1.0:
        raise SystemExit(f"outline fit for {master} is too loose ({rms:.3f}px) -- refusing to cut")
    return (L, R, T, B, r, m)


def main() -> None:
    out_app = HERE / "app"
    out_tray = HERE / "tray"
    out_app.mkdir(exist_ok=True)
    out_tray.mkdir(exist_ok=True)

    print("MEASURE APP TILES")
    app_fits = {}
    for state in APP_STATES:
        master = HERE / f"claude-monitor-{state}.png"
        if not master.exists():
            print(f"  (skip, no master: {master.name})")
            continue
        app_fits[state] = measure(master)

    print()
    print("MEASURE TRAY TILES")
    tray_fits = {}
    for state in TRAY_STATES:
        master = HERE / f"claude-monitor-tray-{state}-master.png"
        if not master.exists():
            print(f"  (skip, no master: {master.name})")
            continue
        tray_fits[state] = measure(master)

    print()
    print("CUT APP TILES")
    rel_r, m_star, extra = unify(app_fits)
    print(f"  shared corner: r/w={rel_r:.5f} m={m_star:.3f}")
    for state, fit in app_fits.items():
        L, R, T, B, r, m = fit
        geom = (L, R, T, B, rel_r * (R - L), m_star)
        inset = INSET + extra[state]
        sizes = sorted({APP_PNG_SIZE, *APP_ICO_SIZES})
        rendered = {s: render(HERE / f"claude-monitor-{state}.png", geom, s, inset) for s in sizes}
        rendered[APP_PNG_SIZE].save(out_app / f"claude-monitor-{state}.png", optimize=True)
        write_ico(out_app / f"claude-monitor-{state}.ico", {s: rendered[s] for s in APP_ICO_SIZES})
        print(f"  {state:9s} r={geom[4]:7.2f} (own {r:7.2f}) inset={inset:5.2f}px")
        qa(rendered[APP_PNG_SIZE], f"{state} @{APP_PNG_SIZE}")

    print()
    print("CUT TRAY TILES")
    rel_r, m_star, extra = unify(tray_fits)
    print(f"  shared corner: r/w={rel_r:.5f} m={m_star:.3f}")
    for state, fit in tray_fits.items():
        L, R, T, B, r, m = fit
        geom = (L, R, T, B, rel_r * (R - L), m_star)
        inset = INSET + extra[state]
        sizes = sorted({TRAY_PNG_SIZE, *TRAY_ICO_SIZES, *TRAY_FOLDER_SIZES})
        master = HERE / f"claude-monitor-tray-{state}-master.png"
        rendered = {s: render(master, geom, s, inset) for s in sizes}
        rendered[TRAY_PNG_SIZE].save(out_tray / f"claude-monitor-tray-{state}.png", optimize=True)
        write_ico(out_tray / f"claude-monitor-tray-{state}.ico", {s: rendered[s] for s in TRAY_ICO_SIZES})
        for s in TRAY_FOLDER_SIZES:
            d = out_tray / f"{s}x{s}"
            d.mkdir(exist_ok=True)
            rendered[s].save(d / f"claude-monitor-tray-{state}.png", optimize=True)
        print(f"  {state:9s} r={geom[4]:7.2f} (own {r:7.2f}) inset={inset:5.2f}px")
        qa(rendered[TRAY_PNG_SIZE], f"{state} @{TRAY_PNG_SIZE}")

    print()
    print("done")


if __name__ == "__main__":
    main()
