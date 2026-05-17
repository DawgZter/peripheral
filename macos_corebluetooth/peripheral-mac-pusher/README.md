# Peripheral Mac Pusher

Small macOS CoreBluetooth helper used by the HUD runtime to send validated display frames to paired Peripheral glasses.

## Build

```sh
./build.sh
```

The manual build writes:

```text
.build/manual/peripheral-mac-pusher
```

## Basic Usage

```sh
.build/manual/peripheral-mac-pusher --scan-only --timeout 8
.build/manual/peripheral-mac-pusher --text "PERIPHERAL READY"
```

The HUD runtime normally invokes the helper through stdin mode and sends deterministic frame bytes produced by `peripheral-hud-runtime/packages/peripheral-driver`.

## Runtime Boundary

The helper owns scanning, connecting, notifications, and characteristic writes. It does not accept arbitrary agent output directly. Agents produce semantic HUD JSON; the TypeScript renderer and driver validate and encode that data before this helper writes anything to the live display transport.

## Connection Checks

A successful low-level write acknowledgement means the write path responded. It does not by itself prove the wearer-visible panel changed. For live tests, keep the sequence conservative:

1. Confirm the glasses are paired and available to macOS.
2. Build the helper with `./build.sh`.
3. Start with one static HUD frame.
4. Observe the result through the live display view before running a multi-frame demo.

## Stdin Control Tokens

The helper accepts these internal tokens from trusted local tooling:

```text
__PERIPHERAL_CLEAR__
__PERIPHERAL_RAW_WRITE__:<hex>
__PERIPHERAL_RAW_WRITE_NR__:<hex>
__PERIPHERAL_WAIT_APP_STATUS__:<appIdHex>:<statusHex>[:timeoutSeconds]
```

They are intentionally not part of the semantic agent API.
