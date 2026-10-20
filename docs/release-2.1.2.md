# Skaro 2.1.2

Draft release notes. Publish only after all six native platform artifacts and
their update metadata have passed the release workflow. These download links
are reserved for that release and are not yet published.

## Changes

- Reduced startup dependency loading and unnecessary work on large project data.
- Restored the last workspace, with indexed project and conversation loading.
- Improved paging, rendering and copying of long conversation histories,
  documents, command output and diffs while preserving access to full contents.
- Kept unanswered questions visible and blocked dependent work until all answers arrive.
- Added immediate feedback for submitted messages and task launches.
- Fixed document tree rows shrinking when expanding a list that overflows the panel.

## Downloads

| System | x64 | arm64 |
| --- | --- | --- |
| Windows | [Download](https://github.com/dartdavros/skaro/releases/download/v2.1.2/Skaro-2.1.2-win-x64.exe) | [Download](https://github.com/dartdavros/skaro/releases/download/v2.1.2/Skaro-2.1.2-win-arm64.exe) |
| macOS | [Download](https://github.com/dartdavros/skaro/releases/download/v2.1.2/Skaro-2.1.2-mac-x64.dmg) | [Download](https://github.com/dartdavros/skaro/releases/download/v2.1.2/Skaro-2.1.2-mac-arm64.dmg) |
| Linux | [Download](https://github.com/dartdavros/skaro/releases/download/v2.1.2/Skaro-2.1.2-linux-x86_64.AppImage) | [Download](https://github.com/dartdavros/skaro/releases/download/v2.1.2/Skaro-2.1.2-linux-arm64.AppImage) |

Builds have no publisher signature or notarization. macOS updates are installed
manually. Windows/Linux use full installer downloads with SHA512 verification.

Agent pins remain Codex 0.159.2 and Claude Code 2.1.285 (SDK 0.3.285).
New model calls were not authorized for this preparation and were not performed.
