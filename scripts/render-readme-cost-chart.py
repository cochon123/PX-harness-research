#!/usr/bin/env python3
"""Render the README cost chart from reports/model-cost-analysis.json.

Reads the committed comparison file and writes reports/model-cost-chart.png.
Numbers on the chart are formatted from that JSON; nothing is hardcoded.

Requires Pillow. Inter is used when it is installed; otherwise Pillow's
built-in bitmap font is used.

    python3 scripts/render-readme-cost-chart.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.stderr.write("Pillow is required: python3 -m pip install pillow\n")
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "reports" / "model-cost-analysis.json"
OUTPUT = ROOT / "reports" / "model-cost-chart.png"

INK = (23, 32, 25, 255)
MUTED = (102, 115, 108, 255)
PAPER = (247, 248, 243, 255)
PANEL = (255, 255, 255, 255)
LINE = (220, 227, 221, 255)
TRACK = (238, 242, 236, 255)
AMBER = (189, 122, 32, 255)
GREEN = (23, 99, 63, 255)

WIDTH = 1280
HEIGHT = 900
MARGIN = 48

FONT_CANDIDATES = {
    "regular": [
        "/usr/share/fonts/truetype/macos/Inter-Regular.ttf",
        "/usr/share/fonts/truetype/inter/Inter-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    "semibold": [
        "/usr/share/fonts/truetype/macos/Inter-SemiBold.ttf",
        "/usr/share/fonts/truetype/inter/Inter-SemiBold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "bold": [
        "/usr/share/fonts/truetype/macos/Inter-Bold.ttf",
        "/usr/share/fonts/truetype/inter/Inter-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
}


def load_font(kind: str, size: int) -> ImageFont.ImageFont:
    for path in FONT_CANDIDATES[kind]:
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def money(value: float) -> str:
    return f"${value:.4f}"


def score_label(score: float) -> str:
    percent = score * 100
    if abs(percent - round(percent)) < 0.05:
        return f"{round(percent):.0f}%"
    return f"{percent:.1f}%"


def load_rows() -> tuple[str, list[dict]]:
    payload = json.loads(SOURCE.read_text())
    rows = []
    for row in payload["rows"]:
        if not row.get("ran"):
            continue
        if row.get("measuredCost") is None or row.get("score") is None:
            continue
        rows.append(row)
    if not rows:
        raise SystemExit(f"No completed rows in {SOURCE}")
    return payload.get("generatedAt", ""), rows


def main() -> None:
    generated_at, rows = load_rows()
    date = generated_at[:10] if generated_at else "unknown date"
    max_cost = max(row["measuredCost"] for row in rows)
    total_cost = sum(row["measuredCost"] for row in rows)

    regular = load_font("regular", 18)
    regular_sm = load_font("regular", 15)
    semibold = load_font("semibold", 18)
    title_font = load_font("bold", 32)
    header_font = load_font("semibold", 14)

    image = Image.new("RGBA", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, WIDTH - 24, HEIGHT - 24), radius=16, fill=PANEL, outline=LINE, width=2)

    draw.text((MARGIN, 44), "Measured API cost by model", font=title_font, fill=INK)
    subtitle = (
        f"Ten completed models from reports/model-cost-analysis.json, generated {date}. "
        "Each model ran the same 7-task browser slice."
    )
    draw.text((MARGIN, 92), subtitle, font=regular_sm, fill=MUTED)

    header_y = 140
    columns = {
        "model": 48,
        "passed": 300,
        "score": 400,
        "bar": 510,
    }
    bar_right = 1048
    cost_x = 1064
    draw.text((columns["model"], header_y), "MODEL", font=header_font, fill=MUTED)
    draw.text((columns["passed"], header_y), "PASSED", font=header_font, fill=MUTED)
    draw.text((columns["score"], header_y), "SCORE", font=header_font, fill=MUTED)
    draw.text((columns["bar"], header_y), "MEASURED COST (USD)", font=header_font, fill=MUTED)
    draw.line((MARGIN, 168, WIDTH - MARGIN, 168), fill=LINE, width=2)

    row_top = 184
    row_h = 56
    bar_h = 18
    for index, row in enumerate(rows):
        y = row_top + index * row_h
        if index % 2 == 0:
            draw.rectangle((36, y - 8, WIDTH - 36, y + row_h - 16), fill=(251, 252, 248, 255))
        label_y = y + 6
        draw.text((columns["model"], label_y), row["label"], font=semibold, fill=INK)
        draw.text((columns["passed"], label_y), f"{row['passed']}/{row['total']}", font=regular, fill=INK)
        draw.text((columns["score"], label_y), score_label(row["score"]), font=regular, fill=INK)

        bar_y = label_y + 2
        draw.rounded_rectangle((columns["bar"], bar_y, bar_right, bar_y + bar_h), radius=9, fill=TRACK)
        span = bar_right - columns["bar"]
        width = 0 if max_cost == 0 else round(span * (row["measuredCost"] / max_cost))
        if width > 0:
            draw.rounded_rectangle(
                (columns["bar"], bar_y, columns["bar"] + max(width, 4), bar_y + bar_h),
                radius=9,
                fill=AMBER,
            )
        draw.text((cost_x, bar_y - 1), money(row["measuredCost"]), font=regular_sm, fill=INK)

    footer_y = row_top + len(rows) * row_h + 8
    draw.line((MARGIN, footer_y, WIDTH - MARGIN, footer_y), fill=LINE, width=2)
    footer_lines = [
        f"Bar length is measuredCost, scaled to the largest value in the file ({money(max_cost)}). Sum of measuredCost: {money(total_cost)}.",
        "Score is lowThinkingScore. Passed counts tasks flagged passed.",
    ]
    for offset, line in enumerate(footer_lines):
        draw.text((MARGIN, footer_y + 16 + offset * 24), line, font=regular_sm, fill=MUTED)
    draw.text((MARGIN, footer_y + 16 + len(footer_lines) * 24), "Rendered by scripts/render-readme-cost-chart.py.", font=regular_sm, fill=GREEN)

    image.convert("RGB").save(OUTPUT, format="PNG", optimize=True)
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({len(rows)} rows, generated {date})")


if __name__ == "__main__":
    main()
