# Peripheral

Mac-connected Agent HUD runtime and display tooling for Peripheral glasses.

This repository contains the public Peripheral runtime slice. It excludes local environment files, generated artifacts, and machine-specific notes.

## Repo Layout

- `web/` contains display observation clients for a local sidecar.
- `macos_corebluetooth/peripheral-mac-pusher/` contains the small macOS helper used for real display pushes.
- `docs/` contains public API, protocol, demo, and roadmap notes.
- `peripheral-hud-runtime/` contains the Mac-connected Agent HUD Runtime: semantic widgets, monochrome renderer, driver wrapper, CLI commands, mock demos, and latency tooling.

## Current State

- The HUD runtime can run without hardware through `peripheralctl hud --mock-display --text`.
- The renderer turns validated semantic widgets into deterministic monochrome frames.
- The driver supports mock runs by default and requires explicit opt-in for live display pushes.
- The web clients can connect to a compatible local sidecar when display observation is intentionally enabled.

## Local Usage

Run this next to the existing sidecar server from the full workspace. The page expects API endpoints like:

- GET /api/config
- GET /api/framebuffer/dirty-stream
- GET /api/framebuffer/stream

The local sidecar normally serves these at:

    http://127.0.0.1:8791/cast-mirror.html

This repo is meant to show the Peripheral runtime cleanly. It contains the public runtime, viewing clients, helper source, and documentation needed to build and test the demo.

## Checks

```sh
npm run check:viewer
npm --prefix peripheral-hud-runtime test
npm run pusher:build
```

For HUD runtime commands and live-glasses safety notes, see `peripheral-hud-runtime/docs/HUD_RUNTIME.md`.
