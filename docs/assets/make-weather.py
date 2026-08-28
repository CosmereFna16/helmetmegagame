#!/usr/bin/env python3
"""Builds the eight per-weather banners #turns posts above each turn
announcement (see db/lib/turnAnnouncement.js).

    python3 make-weather.py <dir-of-source-photos>

Each output is a genuine photo, not a derived one: the source directory is
expected to hold eight images, one per weather *and* phase, named with a
two-letter phase prefix ("da"/"du" for dawn/dusk) followed by a one-letter
weather code (c/f/r/s for clear/fog/rain/storm) — e.g. `dac.png` is the
clear-dawn source. Each is centre-cropped to the banner aspect and resized
to the exact frame, no colour grade — the plates already carry their own
dawn/dusk light, so grading them again would double-tint them.

Requires Pillow — same throwaway-venv story as make-banner.py, whose frame
constant (2446x1122) this deliberately shares so the #info banner and the
weather banners read as one system.

Output is JPEG, not PNG: these are photographs, where PNG costs ~2.2MB each
and eight of them would put ~18MB of binary in the repo for no visible gain.
"""

import argparse
import glob
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_W, OUT_H = 2446, 1122          # same frame as docs/assets/info-banner.png
JPEG_QUALITY = 92
OUT = os.path.join(HERE, "weather")
WEATHERS = ("clear", "fog", "rain", "storm")
PHASES = ("dawn", "dusk")

# Source filename stems, keyed by (weather, phase). Matched regardless of
# extension — the source photos arrive as a mix of .png and .jpg.
STEMS = {
    ("clear", "dawn"): "dac", ("fog", "dawn"): "daf",
    ("rain", "dawn"): "dar", ("storm", "dawn"): "das",
    ("clear", "dusk"): "duc", ("fog", "dusk"): "duf",
    ("rain", "dusk"): "dur", ("storm", "dusk"): "dus",
}


def find_sources(src_dir):
    """Match each (weather, phase) to a file in `src_dir` by its stem."""
    found = {}
    for key, stem in STEMS.items():
        hits = [p for p in glob.glob(os.path.join(src_dir, f"{stem}.*"))
                if os.path.splitext(p)[1].lower() in (".png", ".jpg", ".jpeg", ".webp")]
        if not hits:
            raise SystemExit(f"No source photo for {stem!r} ({key[0]}-{key[1]}) in {src_dir}")
        found[key] = sorted(hits)[0]
    return found


def fit(path):
    """Centre-crop to the banner aspect, then resize to the exact frame."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    target = OUT_W / OUT_H
    if w / h > target:                      # too wide -> trim the sides
        new_w = int(h * target)
        im = im.crop(((w - new_w) // 2, 0, (w - new_w) // 2 + new_w, h))
    else:                                   # too tall -> trim top/bottom
        new_h = int(w / target)
        im = im.crop((0, (h - new_h) // 2, w, (h - new_h) // 2 + new_h))
    return im.resize((OUT_W, OUT_H), Image.LANCZOS)


def build(sources):
    made = {}
    for (name, phase), path in sources.items():
        out = f"{OUT}/{name}-{phase}.jpg"
        fit(path).save(out, quality=JPEG_QUALITY, subsampling=0)
        made[(name, phase)] = out
        print(f"{os.path.basename(out)}  {os.path.getsize(out) // 1024} KB")
    return made


def sheet(made):
    tw = 760
    th = round(tw * OUT_H / OUT_W)
    pad, label = 14, 34
    W = pad + 2 * (tw + pad)
    H = pad + len(WEATHERS) * (th + label + pad)
    canvas = Image.new("RGB", (W, H), (16, 16, 18))
    d = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
    except OSError:
        font = ImageFont.load_default()

    y = pad
    for name in WEATHERS:
        for col, phase in enumerate(PHASES):
            x = pad + col * (tw + pad)
            d.text((x, y), f"{name.upper()}  ·  {phase}", fill=(215, 215, 220), font=font)
            canvas.paste(Image.open(made[(name, phase)]).resize((tw, th), Image.LANCZOS),
                         (x, y + label))
        y += th + label + pad

    path = f"{OUT}/contact-sheet.png"
    canvas.save(path)
    print("wrote", path, canvas.size)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src_dir", nargs="?", default=os.path.expanduser("~/Desktop"))
    ap.add_argument("--sheet", action="store_true", help="also write a contact sheet")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    made = build(find_sources(args.src_dir))
    if args.sheet:
        sheet(made)
