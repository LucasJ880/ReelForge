#!/usr/bin/env python3
"""
渲染一张全屏透明 PNG，在下三分之一处放一条带半透明圆角底框的中文字幕。

供 stitch-pet-kit-walkthrough-video.ts 使用（因为本机 ffmpeg 未编译 libfreetype，
无法用 drawtext，改为 PIL 渲染字幕图 + ffmpeg overlay 叠加）。

用法：
  python3 scripts/render-caption-png.py <font_path> <caption_file> <out_png> <W> <H> [font_index]
"""
import sys
from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    font_path = sys.argv[1]
    caption_file = sys.argv[2]
    out_path = sys.argv[3]
    width = int(sys.argv[4])
    height = int(sys.argv[5])
    font_index = int(sys.argv[6]) if len(sys.argv) > 6 else 0

    with open(caption_file, "r", encoding="utf-8") as handle:
        text = handle.read().strip()

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    font_size = max(28, int(height * 0.052))
    try:
        font = ImageFont.truetype(font_path, font_size, index=font_index)
    except Exception:
        font = ImageFont.truetype(font_path, font_size)

    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    center_x = width // 2
    center_y = int(height * 0.84)
    pad_x, pad_y = 48, 28

    box = [
        center_x - text_w // 2 - pad_x,
        center_y - text_h // 2 - pad_y,
        center_x + text_w // 2 + pad_x,
        center_y + text_h // 2 + pad_y,
    ]
    draw.rounded_rectangle(box, radius=30, fill=(20, 20, 20, 150))

    text_x = center_x - text_w // 2 - bbox[0]
    text_y = center_y - text_h // 2 - bbox[1]
    # 轻微描边提升可读性
    draw.text((text_x, text_y), text, font=font, fill=(255, 255, 255, 255),
              stroke_width=2, stroke_fill=(0, 0, 0, 180))

    img.save(out_path)
    print(out_path)


if __name__ == "__main__":
    main()
