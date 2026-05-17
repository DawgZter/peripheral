# Local Display Sidecar API Contract

The web pages in this repo expect the existing local sidecar server to provide the display readback API.

## GET /api/config

Used to confirm the display transport is mac before starting a live stream.

## GET /api/glasses/status

Used by the one-click cast page before opening the camera or display stream. It returns known Peripheral devices plus connected and paired subsets.

## POST /api/glasses/pair-connect

Used by Start when no glasses are currently connected. The sidecar powers display transport on, resolves the configured or discovered glasses target, stops any stale display bridge, pairs if needed, and connects through macOS.

This changes local connection state but does not send display content. CLI validation keeps it behind `peripheralctl live-check --attempt-connect --real-hardware-ok` so an operator has to opt into the connection attempt.

## GET /api/framebuffer/dirty-stream

Server-sent events endpoint for compressed dirty-crop streaming.

Typical query parameters:

- sentinelPage=65531
- burst=1
- chunkWindow=8
- fastNoResponse=1
- pageTimeoutMs=6000
- x0, y0, x1, y1 for the display ROI

Important event types:

- hello: stream accepted and metadata attached.
- crop: one crop update, usually with dataBase64, x0, y0, xByte0, widthBytes, and height.
- done: the requested frame count finished.
- stream-error / unsupported: fatal stream states.

## GET /api/framebuffer/stream

Older fixed-page ROI stream. Useful for baseline packed display pages, but less efficient than compressed dirty-crops for the live demo.

## Display Surface Layout

- Width: 540
- Height: 280
- Pixel format: packed 4bpp
- Bytes per row: 270
- Total bytes: 75,600
