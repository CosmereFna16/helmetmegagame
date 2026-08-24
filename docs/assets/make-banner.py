#!/usr/bin/env python3
"""Regenerates docs/assets/info-banner.png, or builds the same gothic banner
over any other background image.

    python3 make-banner.py <background.png> [-o out.png] [-t "Lifeweb"]

Requires Pillow, which is NOT a repo dependency (this is a Node monorepo) and
which macOS's system Python refuses to install into. Use a throwaway venv:

    python3 -m venv /tmp/banner && /tmp/banner/bin/pip install Pillow
    /tmp/banner/bin/python docs/assets/make-banner.py <background.png>

Every measurement below is a RATIO of the output width, not a pixel count, so
the same numbers reproduce the identical look on a background of any size.
The one thing that is not size-invariant is the source crop: CROP_BOTTOM was
chosen for one specific photo (to lift the type off a subject in the lower
right) and is worth re-tuning per background.
"""

import argparse
import os
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_PATH = os.path.join(HERE, "..", "..", "web", "assets", "fonts", "UnifrakturMaguntia.ttf")

CROP_BOTTOM = 0.15    # trim this fraction off the bottom before anything else
BRIGHTNESS = 0.90     # "darken 10"
SATURATION = 1.45     # vivid forest; deliberately NOT a channel/hue shift,
                      # which tints the whole frame instead of enriching it
BLUR = 0.00123        # gaussian radius as a fraction of width (3px at 2446)
TEXT_WIDTH = 0.52     # the word's INK width as a fraction of the output width
SHADOW_BLUR = 0.05    # fractions of the font size, not the width
SHADOW_DROP = 0.02
SHADOW_ALPHA = 170


def build(src_path, out_path, text):
    im = Image.open(src_path).convert("RGB")
    w, h = im.size
    im = im.crop((0, 0, w, int(h * (1 - CROP_BOTTOM))))
    w, h = im.size

    im = ImageEnhance.Brightness(im).enhance(BRIGHTNESS)
    im = ImageEnhance.Color(im).enhance(SATURATION)
    im = im.filter(ImageFilter.GaussianBlur(radius=w * BLUR))

    # Solve the font size from the glyphs' INK box rather than the advance
    # width: blackletter carries wide side bearings, so sizing on the advance
    # leaves the word visibly narrower than asked for, and centring on it
    # leaves it visibly off-centre.
    probe = ImageFont.truetype(FONT_PATH, 100)
    pb = probe.getbbox(text)
    size = max(10, int(100 * int(w * TEXT_WIDTH) / (pb[2] - pb[0])))

    font = ImageFont.truetype(FONT_PATH, size)
    bb = font.getbbox(text)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    x = (w - tw) / 2 - bb[0]
    y = (h - th) / 2 - bb[1]

    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text(
        (x, y + size * SHADOW_DROP), text, font=font, fill=(0, 0, 0, SHADOW_ALPHA)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=size * SHADOW_BLUR))
    im = Image.alpha_composite(im.convert("RGBA"), shadow)

    ImageDraw.Draw(im).text((x, y), text, font=font, fill=(255, 255, 255, 255))
    im.convert("RGB").save(out_path)
    print(f"{out_path}  {w}x{h}  font {size}px  ink {tw}x{th}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("background")
    ap.add_argument("-o", "--out", default=os.path.join(HERE, "info-banner.png"))
    ap.add_argument("-t", "--text", default="Lifeweb")
    args = ap.parse_args()
    build(args.background, args.out, args.text)
