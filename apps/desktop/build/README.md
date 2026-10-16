# Application icon

`icon-source.png` is the fictional red planet approved by the owner on
2026-10-07. The exports only resize the artwork and preserve its transparent
background and composition.

The application resources are:

- `icon-source.png`: original 1254 × 1254 RGBA artwork.
- `icon.png`: 1024 × 1024 RGBA.
- `icon.ico`: Windows sizes 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256.
- `icon.icns`: macOS sizes through 1024, including Retina representations.

Electron Builder uses the platform-specific files for application packaging.
The PNG is also copied to `resources/icon.png` for the packaged window icon;
development loads the same PNG from this directory. The macOS dock uses it too.

Rebuilding a platform package applies the new icon to its executable, installer
and shortcuts. Previously built or installed packages keep their old resources.
`icon.svg` is the previous logo retained for reference; it is not used by the
application or packaging configuration.
