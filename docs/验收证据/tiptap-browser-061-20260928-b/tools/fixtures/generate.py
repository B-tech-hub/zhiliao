from pathlib import Path

from PIL import Image, ImageDraw
import pillow_heif

# 纯几何合成图，不包含用户照片、元数据或第三方图片。
root = Path(__file__).resolve().parent
image = Image.new("RGB", (96, 64), (238, 239, 228))
draw = ImageDraw.Draw(image)
draw.rectangle((8, 8, 40, 56), fill=(30, 125, 95))
draw.ellipse((50, 10, 86, 46), fill=(214, 103, 60))
image.save(root / "pattern.png")
pillow_heif.from_pillow(image).save(root / "pattern.heic", quality=85)
