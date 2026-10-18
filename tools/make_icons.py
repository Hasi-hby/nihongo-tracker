"""Render the app icons (PNG for iOS/Android, SVG favicon). Run once: python tools/make_icons.py"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
BG, BLUE, WHITE = (10, 11, 16), (76, 201, 255), (232, 246, 255)
FONTS = [r"C:\Windows\Fonts\YuGothB.ttc", r"C:\Windows\Fonts\meiryob.ttc", r"C:\Windows\Fonts\msgothic.ttc"]


def font(size):
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def render(size):
    s = 4 * size  # supersample
    img = Image.new("RGB", (s, s), BG)
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    c, r = s / 2, s * 0.34
    hexagon = [(c, c - r), (c + r * 0.87, c - r / 2), (c + r * 0.87, c + r / 2), (c, c + r), (c - r * 0.87, c + r / 2), (c - r * 0.87, c - r / 2)]
    gd.polygon(hexagon, outline=BLUE + (255,), width=int(s * 0.03))
    gd.text((c, c + s * 0.01), "日", font=font(int(s * 0.36)), fill=WHITE + (255,), anchor="mm")
    blurred = glow.filter(ImageFilter.GaussianBlur(s * 0.03))
    img.paste(blurred, (0, 0), blurred)
    img.paste(glow, (0, 0), glow)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
        render(size).save(OUT / name)
    (OUT / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0a0b10"/>'
        '<polygon points="32,10 51,21 51,43 32,54 13,43 13,21" fill="none" stroke="#4cc9ff" stroke-width="2.5"/>'
        '<text x="32" y="41" font-size="22" text-anchor="middle" fill="#e8f6ff" font-family="Yu Gothic, Hiragino Sans, sans-serif" font-weight="700">日</text></svg>\n',
        encoding="utf-8")
    print("Icons geschrieben nach", OUT)


if __name__ == "__main__":
    main()
