# Protocol

This is the minimum protocol surface needed for the v0 HUD runtime. It is not a full SDK and it is not live readback API.

The runtime widget set now includes `terminal` for the Hermes CLI view. A terminal widget carries a short `terminal` string array plus an optional `prompt`, and the renderer draws it as a dense monochrome command-line surface rather than a summarized card.

## Display Transport Surface

| Item | Value |
| --- | --- |
| Service | `00007033-0000-1000-8000-00805f9b34fb` |
| Write characteristic | `00002021-0000-1000-8000-00805f9b34fb` |
| Notify/ACK characteristic | `00002022-0000-1000-8000-00805f9b34fb` |
| Other observed characteristics | `2025`, `1001`, `1002`, `2001`, `2002` |

Important boundary: service discovery and write ACKs prove push-channel health, not necessarily wearer-visible rendering.

## Frame Shape

Command frames are wrapped as `bf02` frames:

```text
bf 02
u16le body_length
u16le crc16_ccitt(body)
u16le fragment_index
body
```

A normal command body starts with:

```text
group u8
command u8
payload_length u16le
payload bytes
```

The implementation lives in `macos_corebluetooth/peripheral-mac-pusher/Sources/PeripheralFrame/PeripheralFrame.swift`.

## Image Envelope

The demo uses group `0x07`, command `0x04` image payloads. The logical payload starts after the group/command/length fields:

| Offset | Size | Field | v0 value |
| ---: | ---: | --- | --- |
| 0 | 4 | image prefix | `fe000000` full panel, `00000080` small route |
| 4 | 1 | image marker | `0x16` |
| 5 | 2 | width | `540` full panel, `304` small route |
| 7 | 2 | height | `280` full panel, `179` small route |
| 9 | 1 | bpp | `2` |
| 10 | 1 | compression/header | `7` zlib |
| 11 | 4 | raw bytes | `37800` full panel, `13604` small route |
| 15 | 4 | compressed bytes | zlib stream length |
| 19 | n | compressed data | zlib-compressed packed 2 bpp pixels |

## Default Full-Panel Push

The conservative v0 full-panel sequence is:

```text
1. Write 0701:fe00 using the Mac helper raw-write token.
2. Wait for 0602:fe01 using __PERIPHERAL_WAIT_APP_STATUS__:fe:01:8.
3. Write fragmented 0704 image frames with prefix fe000000.
```

`peripheral-hud-runtime/packages/peripheral-driver` implements this in deterministic code and delegates connection/write mechanics to `macos_corebluetooth/peripheral-mac-pusher/.build/manual/peripheral-mac-pusher`.

## Fragmentation

The image pusher uses:

| Chunk | Size |
| --- | ---: |
| First image fragment payload | 497 bytes |
| Continuation fragment payload | 501 bytes |

The first fragment carries group `07`, command `04`, total image payload length, then the first compressed bytes. Continuations are raw image-payload continuation fragments and should not be decoded as new opcodes.

## Smaller Image Route

The smaller route is documented but not the default:

| Field | Value |
| --- | --- |
| Prefix | `00000080` |
| Geometry | `304x179` |
| Format | 2 bpp zlib/header `7` |
| Raw bytes | `13,604` |

Next experiment if full-panel updates feel too slow: render the same semantic widgets into a constrained `304x179` surface and compare wearer-visible update latency against full panel.

## Safety Notes

- Setup-on-each-push remains the default because setup-skipped writes can ACK without a visible update if the display surface is not active.
- Real pushes should be short and operator-coordinated.
- Do not live-send unvalidated native resource commands.
- Do not treat local outbound frame reconstruction as live display readback.

## Unknowns

- Live transport send duration and ACK timing for these exact v0 frames on live glasses.
- Visible panel refresh cadence under repeated HUD swaps.
- Reliability of no-response image writes for live demos.
- Reliability of setup-skipped same-surface swaps.
- Native resource command shapes for text/image widgets.
