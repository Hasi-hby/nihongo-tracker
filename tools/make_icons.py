"""Render the app icons (PNG for iOS/Android, SVG favicon). Run once: python tools/make_icons.py

The icon matches the app: a thin mint 続 with a soft glow on near-black.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
BG, GLOW, MINT = (5, 8, 7), (31, 181, 143), (159, 245, 220)
FONTS = [r"C:\Windows\Fonts\YuGothL.ttc", r"C:\Windows\Fonts\YuGothR.ttc", r"C:\Windows\Fonts\msgothic.ttc"]


def font(size):
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def render(size):
    s = 4 * size  # supersample
    img = Image.new("RGB", (s, s), BG)
    # soft glow behind the character, inside the maskable safe zone
    glow = Image.new("L", (s, s), 0)
    ImageDraw.Draw(glow).ellipse([s * 0.18, s * 0.16, s * 0.82, s * 0.8], fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.12))
    img.paste(Image.new("RGB", (s, s), GLOW), (0, 0), glow)
    # the character, plus a blurred copy of it as its own light
    text = Image.new("L", (s, s), 0)
    ImageDraw.Draw(text).text((s / 2, s / 2 + s * 0.01), "続", font=font(int(s * 0.5)), fill=255, anchor="mm")
    img.paste(Image.new("RGB", (s, s), (62, 230, 181)), (0, 0), text.filter(ImageFilter.GaussianBlur(s * 0.025)).point(lambda v: v * 0.7))
    img.paste(Image.new("RGB", (s, s), MINT), (0, 0), text)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
        render(size).save(OUT / name)
    (OUT / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g">'
        '<stop offset="0" stop-color="#1fb58f" stop-opacity=".55"/><stop offset="1" stop-color="#1fb58f" stop-opacity="0"/>'
        '</radialGradient></defs><rect width="64" height="64" rx="14" fill="#050807"/><circle cx="32" cy="31" r="26" fill="url(#g)"/>'
        '<text x="32" y="42" font-size="30" text-anchor="middle" fill="#9ff5dc" font-weight="300"'
        ' font-family="Hiragino Sans, Yu Gothic, YuGothic, sans-serif">続</text></svg>\n',
        encoding="utf-8")
    print("Icons geschrieben nach", OUT)


if __name__ == "__main__":
    main()
