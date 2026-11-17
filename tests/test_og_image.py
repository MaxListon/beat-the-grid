"""The share image is redrawn every day by the live job; it must keep its size and the logo's colors."""
from grid import og_image


def test_share_image_size_and_logo_colors():
    im = og_image.draw(1200, 630)
    assert im.size == (1200, 630)
    logo = im.crop((58, 58, 98, 98)).convert("RGB")
    pixels = [logo.getpixel((x, y)) for x in range(logo.width) for y in range(logo.height)]
    assert sum(1 for r, g, b in pixels if b > 200 and g < 150 and r < b) > 20   # the violet line survives the palette
