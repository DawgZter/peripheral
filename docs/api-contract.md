# Local Display Sidecar API Contract

The web pages in this repo expect the existing local sidecar server to provide the display readback API.

## Runtime Protocol Types

The HUD runtime shares typed protocol values for app modes, surface ownership, display commands, input events, and agent events. These contracts let the renderer, runtime, and future broker code exchange normal source-level objects before anything reaches the display transport.

Core enum exports live in `peripheral-hud-runtime/packages/peripheral-protocol/src/index.ts`:

- `APP_MODES` covers `current_stage`, `ambient_agent_hud`, `agent_mode`, `pairing`, `debug`, and `system`.
- `SURFACE_OWNERS`, `SURFACE_PRIORITIES`, and `SURFACE_KINDS` describe who owns a display surface and how urgently it should be shown.
- `SURFACE_COMMAND_KINDS` describes display-intent commands such as showing a card, updating a widget, clearing a surface, or entering agent mode.
- `INPUT_EVENT_KINDS` describes normalized wearer or runtime input such as voice text, taps, head pose, look-up/look-down, and dismiss.
- `AGENT_EVENT_KINDS` and `APPROVAL_RISK_LEVELS` describe agent session status and approval flows.

The exported TypeScript types `SurfaceLease`, `SurfaceCommand`, `InputEvent`, `AgentEvent`, and `UserDecision` are transport-independent. Agents still produce validated semantic widgets; the runtime decides when those objects become rendered Peripheral frames.

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
