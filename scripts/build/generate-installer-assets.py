from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
APP_ASSETS = ROOT / "assets" / "app"
INSTALLER_ASSETS = ROOT / "assets" / "installer"
BACKGROUND = "#171a1c"
PANEL = "#202628"
INK = "#eef3f1"
MUTED = "#8f9b97"
ACCENT = "#52c7ad"
ACCENT_DIM = "#25483f"


def font(size: int, semibold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if semibold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/seguisb.ttf" if semibold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_mark(image: Image.Image, bounds: tuple[int, int, int, int]) -> None:
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = bounds
    width = right - left
    radius = max(4, width // 5)
    draw.rounded_rectangle(bounds, radius=radius, fill=PANEL, outline="#34413e", width=max(1, width // 32))

    inset = width * 0.22
    card = (
        int(left + inset),
        int(top + inset * 0.85),
        int(right - inset * 0.68),
        int(bottom - inset * 0.85),
    )
    stroke = max(2, width // 18)
    draw.rounded_rectangle(
        card,
        radius=max(3, width // 12),
        outline=ACCENT,
        width=stroke,
    )
    x1, y1, x2, y2 = card
    draw.line(
        [
            (x1 + width * 0.10, y2 - width * 0.12),
            (x1 + width * 0.25, y1 + width * 0.34),
            (x1 + width * 0.38, y2 - width * 0.17),
            (x1 + width * 0.52, y1 + width * 0.29),
            (x2 - width * 0.08, y2 - width * 0.12),
        ],
        fill=INK,
        width=max(1, width // 26),
        joint="curve",
    )
    dot = width * 0.055
    cx = x2 - width * 0.14
    cy = y1 + width * 0.14
    draw.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill="#f2b84b")


def create_icon() -> None:
    icon = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw_mark(icon, (8, 8, 248, 248))
    icon.save(APP_ASSETS / "refcanvas.png")
    icon.save(
        INSTALLER_ASSETS / "refcanvas.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


def create_loading_gif() -> None:
    width, height = 268, 167
    frames: list[Image.Image] = []
    title_font = font(17, semibold=True)
    detail_font = font(11)

    for index in range(48):
        frame = Image.new("RGB", (width, height), BACKGROUND)
        draw = ImageDraw.Draw(frame)
        draw_mark(frame, (24, 26, 70, 72))
        draw.text((84, 28), "正在安装", fill=MUTED, font=detail_font)
        draw.text((84, 44), "RefCanvas", fill=INK, font=title_font)
        draw.text(
            (24, 91),
            "正在准备本地素材库与无限白板",
            fill=MUTED,
            font=detail_font,
        )

        bar = (24, 124, width - 24, 128)
        draw.rounded_rectangle(bar, radius=2, fill=ACCENT_DIM)
        travel = (width - 48) + 48
        center = -24 + (index / 47) * travel
        for offset in range(-24, 25):
            x = int(center + offset)
            if bar[0] <= x < bar[2]:
                strength = max(0.0, 1.0 - abs(offset) / 25)
                base = (37, 72, 63)
                bright = (82, 199, 173)
                color = tuple(
                    round(base[channel] + (bright[channel] - base[channel]) * strength)
                    for channel in range(3)
                )
                draw.line((x, bar[1], x, bar[3] - 1), fill=color)

        for dot_index in range(3):
            phase = (index / 8 + dot_index) * math.pi
            alpha = 0.35 + 0.65 * ((math.sin(phase) + 1) / 2)
            base = (143, 155, 151)
            color = tuple(round(value * alpha) for value in base)
            x = width - 43 + dot_index * 7
            draw.ellipse((x, 145, x + 3, 148), fill=color)
        frames.append(frame)

    frames[0].save(
        INSTALLER_ASSETS / "loading.gif",
        save_all=True,
        append_images=frames[1:],
        duration=80,
        loop=0,
        disposal=2,
        optimize=True,
    )


def main() -> None:
    APP_ASSETS.mkdir(parents=True, exist_ok=True)
    INSTALLER_ASSETS.mkdir(parents=True, exist_ok=True)
    create_icon()
    create_loading_gif()


if __name__ == "__main__":
    main()
