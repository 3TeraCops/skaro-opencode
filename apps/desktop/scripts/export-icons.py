"""Crop the approved source once, then downsample every platform icon (Pillow)."""

from pathlib import Path
import shutil

from PIL import Image


BUILD = Path(__file__).resolve().parents[1] / "build"
EXPORT = BUILD.parents[2] / "output" / "icons" / "red-planet"
SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024)


def main():
    source = Image.open(BUILD / "icon-source.png").convert("RGBA")
    # The original has isolated alpha=1 noise outside the planet. Keep every
    # pixel with alpha >= 2, including the soft edge; do not alter crop pixels.
    bounds = source.getchannel("A").point(lambda a: 255 if a > 1 else 0).getbbox()
    if bounds is None:
        raise ValueError("The icon source is empty")
    left, top, right, bottom = bounds
    side = max(right - left, bottom - top)
    left -= (side - (right - left)) // 2
    top -= (side - (bottom - top)) // 2
    box = (left, top, left + side, top + side)
    if min(left, top) < 0 or box[2] > source.width or box[3] > source.height:
        raise ValueError("The square crop would extend beyond the source")
    if side < max(SIZES):
        raise ValueError("The source is too small; never upscale the artwork")
    cropped = source.crop(box)
    EXPORT.mkdir(parents=True, exist_ok=True)
    cropped.save(EXPORT / "red-planet-cropped.png")
    for size in SIZES:
        cropped.resize((size, size), Image.Resampling.LANCZOS).save(
            EXPORT / f"red-planet-{size}.png"
        )
    cropped.save(
        EXPORT / "red-planet.ico", sizes=[(size, size) for size in SIZES if size <= 256]
    )
    cropped.save(EXPORT / "red-planet.icns")
    for src, dest in [
        ("red-planet-1024.png", "icon.png"),
        ("red-planet.ico", "icon.ico"),
        ("red-planet.icns", "icon.icns"),
    ]:
        shutil.copyfile(EXPORT / src, BUILD / dest)
    print(f"Source {source.size}; square crop {box}; output {cropped.size}")


if __name__ == "__main__":
    main()
