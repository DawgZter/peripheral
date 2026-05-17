# Peripheral HUD Runtime

Demo-first v0 for a glasses-native agent HUD on Peripheral monochrome waveguide glasses. It includes a mock-safe Agent HUD Runtime for the pitchable Mac-connected wearable agent loop.

This slice is intentionally thin:

- semantic widget JSON
- deterministic 540x280 monochrome frame renderer
- JSONL-observable mock or dry-run driver
- wrapper around the existing Mac display pusher for real sends

It does not build the full broker, MCP server, native LVGL backend, phone relay, or multi-agent platform yet. Agents should produce structured widget objects; transport packets and arbitrary screenshots stay inside deterministic code.

## Quick Start

```sh
cd peripheral-hud-runtime
npm install
npm run build
npm test
npm run peripheralctl -- hud --mock-display --text
npm run peripheralctl -- hud --mock-display --text --hermes-cli
npm run peripheralctl -- hud --mock-display --mic mac --hermes-cli --mock-hermes --stt-cmd "printf 'voice test prompt\n'"
npm run peripheralctl -- asr-demo --mock-display --mock-hermes --script fixtures/mock_asr_demo.txt --json
npm run peripheralctl -- demo live-call --mock
```

Generated frames land in `out/frames/`. JSONL logs land in `out/logs/`. Both are gitignored.

## Useful Commands

```sh
npm run peripheralctl -- --help
npm run peripheralctl -- render-json fixtures/ui/generic_card.json --out out/frames/generic_card.png
npm run peripheralctl -- push-json fixtures/ui/generic_card.json --mock
npm run peripheralctl -- show-image out/frames/generic_card.png --mock
npm run peripheralctl -- status --mock
npm run peripheralctl -- diagnostics --mock
npm run peripheralctl -- live-check --mock --capture --json
npm run peripheralctl -- measure-latency --mock
npm run peripheralctl -- hud --real --mic mac --hermes-cli --real-hermes
npm run peripheralctl -- asr-demo --mock-display --mock-hermes --script fixtures/mock_asr_demo.txt --json
npm run peripheralctl -- agents --mock
npm run hudctl -- status
npm run hudctl -- show-card --title "Hermes" --body "Visual result ready"
npm run peripheralctl -- demo blackjack --mock
npm run peripheralctl -- demo conference --mock
npm run peripheralctl -- demo agent --mock
```

`live-check --capture` is a read-only sidecar capture, not a pure mock run. It will skip safely unless the local bridge reports ready, and display-changing writes remain separately gated.

Real glasses pushes are supported by the driver but were not run for the initial implementation pass because the glasses were in live use. For the runtime, `--real` is the explicit live-display choice. Older image-push commands that do not have a `--real` switch still require `--real-hardware-ok`.

## Current Status

Works now in mock mode:

- all supported widget fixtures validate and render
- all four canned demos generate frames and JSONL logs
- peripheralctl hud --mock-display --text runs the blank -> look-up -> Hermes -> dynamic result -> blank loop
- peripheralctl hud --mock-display --text --hermes-cli starts in the Hermes terminal view
- peripheralctl hud --mock-display --mic mac --hermes-cli can feed line-based ASR into a Hermes terminal draft; saying `send` submits that draft without adding `send` to the prompt
- tools/openai-realtime-asr.mjs streams the Mac mic to OpenAI Realtime ASR and emits final transcripts as stdout lines for the HUD runtime
- peripheralctl asr-demo --mock-display --mock-hermes replays scripted transcript lines through the same HUD handler and writes text-only JSON/JSONL proof
- hudctl can show validated JSON/cards, clear mock display state, report status, and emit manual agent status
- mock push, clear, status, diagnostics, and latency commands work
- the driver can build the existing `0704` full-panel image envelope
- the real send path delegates transport to `macos_corebluetooth/peripheral-mac-pusher`

Mocked or not proven in this pass:

- wearer-visible latency
- live transport airtime and ACK timing
- smaller 304x179 route live speed
- native/text LVGL resource backend

Read next:

- `docs/DEMO.md` for exact demo commands
- `docs/HUD_RUNTIME.md` for the real Agent HUD Runtime
- `docs/PROTOCOL.md` for the documented image-push interface
- `docs/LATENCY.md` for measured mock timing and live-test gates
- `docs/ROADMAP.md` for how this grows into broker/MCP/native UI
