# Inventory

This inventory is scoped to the v0 Peripheral HUD runtime and live display files included in this monorepo.

## Included Transport Pieces

| Area | Current artifact | What it contributes |
| --- | --- | --- |
| Mac display helper | `macos_corebluetooth/peripheral-mac-pusher/` | macOS scan/connect/write path, notification handling, stdin control tokens, and ACK timing logs. |
| Frame wrapper | `macos_corebluetooth/peripheral-mac-pusher/Sources/PeripheralFrame/PeripheralFrame.swift` | `bf02` frame shape, command body layout, and CRC16-CCITT. |
| Live display view | `web/cast-mirror.*`, `web/real-mirror.*` | Live readback pages used to observe wearer-visible display updates. |
| HUD runtime | `peripheral-hud-runtime/` | Semantic widgets, deterministic renderer, image driver, CLI, mock runtime, logs, and docs. |

## Current Push Path

The best working v0 image path is a full-panel image route:

```text
0701:fe00
wait for 0602:fe01
0704 image envelope with prefix fe000000
bf02-fragmented writes through 2021
ACK/status notifications through 2022
```

The runtime builds the image envelope deterministically, then sends raw frame hex through the included `peripheral-mac-pusher` stdin bridge. Setup-on-each-push remains the safe default.

## Constants Used By The Demo

- Main display service: `00007033-0000-1000-8000-00805f9b34fb`.
- Write characteristic: `00002021-0000-1000-8000-00805f9b34fb`.
- Notify/ACK characteristic: `00002022-0000-1000-8000-00805f9b34fb`.
- Full-panel frame surface: `540x280`, 2 bpp, raw 37,800 bytes, prefix `fe000000`.
- Smaller image surface to evaluate later: `304x179`, 2 bpp, raw 13,604 bytes, prefix `00000080`.
- Image fragmentation: 497-byte first payload fragment, then 501-byte continuation fragments.

## New HUD Implementation

| Path | Purpose |
| --- | --- |
| `apps/peripheralctl/` | CLI command entrypoint and canned demo flows. |
| `packages/peripheral-protocol/` | Widget schema/types, display constants, validation, text normalization. |
| `packages/peripheral-renderer/` | Deterministic bitmap renderer, built-in pixel font, PNG writer, 2 bpp packer. |
| `packages/peripheral-driver/` | Mock/dry-run logs, image envelope builder, Mac helper wrapper, status/clear/push functions. |
| `packages/peripheral-runtime/` | Blank-by-default Agent HUD runtime, agent registry, Hermes adapter, dynamic widget watcher. |
| `fixtures/ui/` | Structured widget JSON for every supported widget type plus an invalid fixture. |
| `fixtures/images/` | Structured avatar/headshot placeholders for person-detail demos. |
| `tests/` | Smoke tests for schema validation, rendering, frame building, and HUD runtime acceptance. |

## Smaller Route Status

The smaller `304x179` route is exposed in diagnostics as an alternate capability, but the v0 renderer defaults to the full-panel `540x280` surface. Smaller-route live speed was not measured in this pass.

## Unknowns

- Actual wearer-visible refresh latency for repeated full-panel HUD swaps.
- Whether the `304x179` route is visibly faster and acceptable for the demos.
- Whether no-setup same-surface pushes are reliable enough after a freshly primed full-panel route.
- Whether no-response writes improve visible latency without reliability regressions.
- Native/text resource command transport for labels, images, and incremental updates.
- Real touch/head/audio inputs for demo control.
