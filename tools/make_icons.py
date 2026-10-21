"""Render the app icons (PNG for iOS/Android, SVG favicon). Run once: python tools/make_icons.py

The icon is a hanko (判子): a white 続 cut into a vermilion seal on paper.
"""

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
PAPER, SHU = (247, 243, 234), (200, 22, 29)
FONTS = [r"C:\Windows\Fonts\yumindb.ttf", r"C:\Windows\Fonts\yumin.ttf", r"C:\Windows\Fonts\msmincho.ttc"]


def font(size):
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def render(size):
    s = 4 * size  # supersample
    seal = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(seal)
    m = s * 0.19  # inside the maskable safe zone
    d.rounded_rectangle([m, m, s - m, s - m], radius=s * 0.07, fill=255)
    d.text((s / 2, s / 2 + s * 0.005), "続", font=font(int(s * 0.44)), fill=0, anchor="mm")
    # worn ink: a few paper-coloured specks and a slightly soft edge, the same every run
    rnd = random.Random(7)
    for _ in range(60):
        x, y, r = rnd.uniform(m, s - m), rnd.uniform(m, s - m), rnd.uniform(s * 0.0015, s * 0.0045)
        d.ellipse([x - r, y - r, x + r, y + r], fill=0)
    seal = seal.filter(ImageFilter.GaussianBlur(s * 0.0025)).rotate(-4, resample=Image.BICUBIC)
    img = Image.new("RGB", (s, s), PAPER)
    img.paste(Image.new("RGB", (s, s), SHU), (0, 0), seal)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
        render(size).save(OUT / name)
    (OUT / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f7f3ea"/>'
        '<g transform="rotate(-4 32 32)"><rect x="10" y="10" width="44" height="44" rx="5" fill="#c8161d"/>'
        '<text x="32" y="42.5" font-size="29" text-anchor="middle" fill="#fffdf8" font-weight="700"'
        ' font-family="Hiragino Mincho ProN, Yu Mincho, YuMincho, serif">続</text></g></svg>\n',
        encoding="utf-8")
    print("Icons geschrieben nach", OUT)


if __name__ == "__main__":
    main()
