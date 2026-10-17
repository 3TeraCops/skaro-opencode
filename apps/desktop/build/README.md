# Application icon

`icon-source.png` is the fictional red planet approved by the owner on
2026-10-07. Per the owner's request on 2026-10-18, exports remove the surrounding
padding with a square crop before proportional downsampling. The artwork and
its transparent background are preserved; the original source stays unchanged.

The application resources are:

- `icon-source.png`: original 1254 × 1254 RGBA artwork.
- `icon.png`: 1024 × 1024 RGBA.
- `icon.ico`: Windows sizes 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256.
- `icon.icns`: macOS sizes through 1024, including Retina representations.

Regenerate with `python apps/desktop/scripts/export-icons.py` (requires Pillow).
The 1254 × 1254 source is cropped to `(72, 74, 1183, 1185)` (1111 × 1111).
Only empty padding and isolated alpha=1 noise outside the planet are discarded;
every source pixel with alpha >= 2 is retained. The crop is never stretched or
upscaled. Each PNG and platform representation is downsampled from that crop.
The crop and PNG sizes 16–1024 are also exported to `output/icons/red-planet/`.

Electron Builder uses the platform-specific files for application packaging.
The PNG is also copied to `resources/icon.png` for the packaged window icon;
development loads the same PNG from this directory. The macOS dock uses it too.

Rebuilding a platform package applies the new icon to its executable, installer
and shortcuts. Previously built or installed packages keep their old resources.
`icon.svg` is the previous logo retained for reference; it is not used by the
application or packaging configuration.
