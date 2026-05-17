# Peripheral

Mac-connected Agent HUD runtime and live display tooling for Peripheral glasses.

This repository intentionally contains the pitchable Peripheral runtime slice, not the whole local device workspace. It excludes private local captures, environment files, and bulky generated artifacts.

## Repo Layout

- `web/` contains the live display observation clients.
- `macos_corebluetooth/peripheral-mac-pusher/` contains the small macOS helper used for real display pushes.
- `docs/`, `analysis/`, and `evidence/` contain the curated Peripheral proof notes and small verification artifacts.
- `peripheral-hud-runtime/` contains the Mac-connected Agent HUD Runtime: semantic widgets, monochrome renderer, driver wrapper, CLI commands, mock demos, latency tooling, and Hermes adapter stub.

## Current State

- The glasses expose a real display-surface readback path over the local Mac sidecar.
- The practical stream path uses compressed dirty-crop reads rather than full-surface pulls.
- The one-click demo page is web/cast-mirror.html.
- The advanced tuning page is web/real-mirror.html.
- The current POV page starts with a wide text-band scan, focuses on the detected display content, periodically rescans, and renders a green optical HUD over the selected Mac camera.
- The HUD runtime can run without hardware through `peripheralctl hud --mock-display --text`, then use the existing full-image path when live pushes are intentionally enabled.

## Local Usage

Run this next to the existing sidecar server from the full workspace. The page expects API endpoints like:

- GET /api/config
- GET /api/framebuffer/dirty-stream
- GET /api/framebuffer/stream

The local sidecar normally serves these at:

    http://127.0.0.1:8791/cast-mirror.html

This repo is meant to show the Peripheral product/engineering progression cleanly. It contains only the curated runtime, viewing clients, helper source, and small verification artifacts needed for the demo.

## Checks

```sh
npm run check:viewer
npm --prefix peripheral-hud-runtime test
npm run pusher:build
```

For HUD runtime commands and live-glasses safety notes, see `peripheral-hud-runtime/docs/HUD_RUNTIME.md`.
