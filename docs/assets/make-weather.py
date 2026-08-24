#!/usr/bin/env python3
"""Builds the eight per-weather banners #turns posts above each turn
announcement (see db/lib/turnAnnouncement.js).

    python3 make-weather.py <dir-of-source-photos>

expecting clear/fog/rain/storm named anything with those words in them.
Requires Pillow — same throwaway-venv story as make-banner.py, whose frame
constants (2446x1122, BLUR) this deliberately shares so the #info banner and
the weather banners read as one system.

Output is JPEG, not PNG: these are photographs, where PNG costs ~2.2MB each
and eight of them would put ~18MB of binary in the repo for no visible gain.
"""

import argparse
import glob
import os
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw, ImageFont, ImageChops, ImageOps
from PIL import ImageStat

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_W, OUT_H = 2446, 1122          # same frame as docs/assets/info-banner.png
BLUR = 0.00123                      # same finish ratio as the #info banner
JPEG_QUALITY = 92
OUT = os.path.join(HERE, "weather")
WEATHERS = ("clear", "fog", "rain", "storm")

# The four photos differ hugely in base exposure — fog is a bright, nearly
# shadowless plate, storm is already almost night. A fixed brightness
# multiplier therefore can't serve both: it turns fog sepia and storm black.
# Each grade instead normalizes toward a TARGET mean luminance and is only
# allowed to move the image so far (EXPOSURE_CLAMP), so a dark source stays
# legible and a bright one still reads as graded.
DAWN_TARGET, DUSK_TARGET = 132, 68
EXPOSURE_CLAMP = (0.42, 1.55)

# Per-photo corrections applied before the grade. Fog is the outlier in every
# direction — a bright, flat, nearly colourless plate — so it needs its own
# push to sit alongside the other three rather than reading as a blank sky.
PER_SOURCE = {
    "fog": {"exposure": 0.74, "contrast": 1.30, "saturation": 1.35},
}

# Per-photo dawn colour overrides. The clear plate is already an autumn
# hillside — it arrives saturated, so the vibrance pass that rescues the
# duller three tips it over. Left at the source's own colour instead.
DAWN_COLOUR = {
    "clear": {"vibrance": 0.0, "saturation": 1.0},
}
DAWN_COLOUR_DEFAULT = {"vibrance": 0.55, "saturation": 1.12}


def find_sources(src_dir):
    """Match each weather to a file in `src_dir` by name, whatever its
    extension — the source photos arrive as a mix of .png and .jpg."""
    found = {}
    for name in WEATHERS:
        hits = [p for p in glob.glob(os.path.join(src_dir, "*"))
                if name in os.path.basename(p).lower()
                and os.path.splitext(p)[1].lower() in (".png", ".jpg", ".jpeg", ".webp")]
        if not hits:
            raise SystemExit(f"No source photo for {name!r} in {src_dir}")
        found[name] = sorted(hits)[0]
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


def expose(im, target):
    mean = ImageStat.Stat(im.convert("L")).mean[0]
    factor = min(max(target / max(mean, 1), EXPOSURE_CLAMP[0]), EXPOSURE_CLAMP[1])
    return ImageEnhance.Brightness(im).enhance(factor)


def vibrance(im, amount):
    """Saturate the DULL pixels hardest and leave already-vivid ones alone.

    A flat Color enhance clips whatever is already saturated (the orange
    bracken in rain, the tower's lichen in clear) long before the muted parts
    of the frame come up. Masking by each pixel's existing saturation is what
    separates vibrance from saturation.
    """
    r, g, b = im.split()
    hi = ImageChops.lighter(ImageChops.lighter(r, g), b)
    lo = ImageChops.darker(ImageChops.darker(r, g), b)
    dull = ImageOps.invert(ImageChops.difference(hi, lo))     # bright = unsaturated
    return Image.composite(ImageEnhance.Color(im).enhance(1 + amount), im, dull)


def tint(im, color, amount, mask):
    """Blend toward `color` only where `mask` is bright."""
    layer = Image.new("RGB", im.size, color)
    return Image.composite(Image.blend(im, layer, amount), im, mask)


def split_tone(im, shadow, shadow_amt, highlight, high_amt):
    """Tint shadows and highlights toward different colours.

    A global channel multiply (the naive approach) flattens a low-contrast
    plate like fog into uniform sepia, because every pixel moves the same
    way. Masking by luminance instead keeps the two ends of the range
    separate, which is what actually reads as a time of day.
    """
    highs = im.convert("L")
    shadows = ImageOps.invert(highs)
    im = tint(im, shadow, shadow_amt, shadows)
    return tint(im, highlight, high_amt, highs)


def vignette(im, strength):
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((-w * 0.20, -h * 0.45, w * 1.20, h * 1.45), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.09))
    return Image.composite(im, ImageEnhance.Brightness(im).enhance(1 - strength), mask)


def dawn(im, colour=None):
    """Cool but vivid — morning light, colour pushed up rather than washed out."""
    colour = colour or DAWN_COLOUR_DEFAULT
    im = expose(im, DAWN_TARGET)
    if colour["vibrance"]:
        im = vibrance(im, colour["vibrance"])
    im = ImageEnhance.Color(im).enhance(colour["saturation"])
    im = ImageEnhance.Contrast(im).enhance(0.96)
    im = split_tone(im, (74, 96, 128), 0.15, (222, 235, 245), 0.10)
    bloom = im.filter(ImageFilter.GaussianBlur(im.size[0] * 0.012))
    im = ImageChops.screen(im, ImageEnhance.Brightness(bloom).enhance(0.14))
    return vignette(im, 0.08)


def dusk(im):
    """Dark and dramatic. The warmth is a highlight accent, not a wash — the
    drama comes from depth and contrast, so it still reads as evening on a
    plate with no sun in it at all (fog, storm)."""
    im = expose(im, DUSK_TARGET)
    im = vibrance(im, 0.35)
    im = ImageEnhance.Color(im).enhance(1.15)
    im = ImageEnhance.Contrast(im).enhance(1.30)
    im = split_tone(im, (16, 22, 40), 0.34, (226, 168, 104), 0.15)
    im = ImageEnhance.Brightness(im).enhance(0.88)
    return vignette(im, 0.34)


def build(sources):
    made = {}
    for name, path in sources.items():
        base = fit(path).filter(ImageFilter.GaussianBlur(radius=OUT_W * BLUR))
        mean = ImageStat.Stat(base.convert("L")).mean[0]
        fix = PER_SOURCE.get(name)
        if fix:
            base = ImageEnhance.Brightness(base).enhance(fix["exposure"])
            base = ImageEnhance.Contrast(base).enhance(fix["contrast"])
            base = ImageEnhance.Color(base).enhance(fix["saturation"])
        print(f"{name}: source mean luminance {mean:.0f}{'  (corrected)' if fix else ''}")
        for phase in ("dawn", "dusk"):
            out = f"{OUT}/{name}-{phase}.jpg"
            image = dawn(base, DAWN_COLOUR.get(name)) if phase == "dawn" else dusk(base)
            image.save(out, quality=JPEG_QUALITY, subsampling=0)
            made[(name, phase)] = out
            print(f"  {os.path.basename(out)}  {os.path.getsize(out) // 1024} KB")
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
        for col, phase in enumerate(("dawn", "dusk")):
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
