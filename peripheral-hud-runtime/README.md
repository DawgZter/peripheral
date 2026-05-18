# Peripheral HUD Runtime

Glasses-native Agent HUD runtime for Peripheral monochrome waveguide glasses. It includes the Mac-connected wearable agent loop, semantic rendering path, and broker-facing adapter surfaces.

This package provides the source-level runtime components:

- semantic widget JSON
- deterministic 540x280 monochrome frame renderer
- JSONL-observable runtime display driver
- wrapper around the existing Mac display pusher for real sends
- broker-facing integration support report
- adapter operation catalog for sponsors and agent CLIs
- glasses runtime state fixtures and Agent Mode surface commands

Agents produce structured widget objects; the broker and phone runtime own leases, approvals, rendering, and transport policy.

## Quick Start

```sh
cd peripheral-hud-runtime
npm install
npm run build
npm test
npm run peripheralctl -- hud --local-display --text
npm run peripheralctl -- hud --local-display --text --hermes-cli
npm run peripheralctl -- hud --local-display --mic mac --hermes-cli --local-hermes --stt-cmd "printf 'Hermes voice test prompt\nsend\n'"
npm run peripheralctl -- asr-replay --local-display --local-hermes --script fixtures/scripted_asr_run.txt --json
npm run peripheralctl -- integrations summary --json
npm run peripheralctl -- integrations live-adapters --json
npm run peripheralctl -- integrations support --json
npm run peripheralctl -- integrations mcp-manifest --json
npm run peripheralctl -- integrations broker-timeline --json
npm run peripheralctl -- integrations phone-runtime --json
npm run peripheralctl -- integrations sponsor-events --json
npm run peripheralctl -- agent-bridge launch-specs --json
npm run peripheralctl -- agent-bridge event --agent codex_cli --session-id codex-check --line "Codex needs approval to run npm test" --json
npm run peripheralctl -- phone-runtime lease --agent codex_cli --line "Codex needs approval to run npm test" --json
npm run peripheralctl -- sponsor-workflows dossier --json
npm run peripheralctl -- sponsor-runtime adapters --json
npm run peripheralctl -- sponsor-runtime request --sponsor stripe --event payment_intent_requires_action --session-id stripe-check --summary "Approve card hold" --json
npm run peripheralctl -- sponsor-workflows widgets --json
npm run peripheralctl -- integrations widgets --json
npm run peripheralctl -- walkthrough live-call --local
npm run peripheralctl -- walkthrough integrations --local
```

Generated frames land in `out/frames/`. JSONL logs land in `out/logs/`. Both are gitignored.

## Useful Commands

```sh
npm run peripheralctl -- --help
npm run peripheralctl -- render-json fixtures/ui/generic_card.json --out out/frames/generic_card.png
npm run peripheralctl -- push-json fixtures/ui/generic_card.json --local
npm run peripheralctl -- show-image out/frames/generic_card.png --local
npm run peripheralctl -- status --local
npm run peripheralctl -- diagnostics --local
npm run peripheralctl -- live-check --local --capture --json
npm run peripheralctl -- measure-latency --local
npm run peripheralctl -- hud --real --mic mac --hermes-cli --real-hermes
npm run peripheralctl -- asr-replay --local-display --local-hermes --script fixtures/scripted_asr_run.txt --json
npm run peripheralctl -- agents --local
npm run peripheralctl -- integrations dossier --json
npm run peripheralctl -- integrations live-adapters --json
npm run peripheralctl -- integrations support --json
npm run peripheralctl -- integrations mcp-manifest --json
npm run peripheralctl -- integrations broker-timeline --json
npm run peripheralctl -- integrations phone-runtime --json
npm run peripheralctl -- agent-bridge dossier --json
npm run peripheralctl -- phone-runtime snapshot --json
npm run peripheralctl -- sponsor-workflows list --json
npm run hudctl -- status
npm run hudctl -- show-card --title "Hermes" --body "Visual result ready"
npm run peripheralctl -- walkthrough blackjack --local
npm run peripheralctl -- walkthrough conference --local
npm run peripheralctl -- walkthrough agent --local
```

`live-check --capture` is a read-only sidecar capture. It waits for the local bridge readiness signal, and display-changing writes remain separately gated.

Real glasses pushes are supported by the driver. For the runtime, `--real` is the explicit live-display choice. Older image-push commands that do not have a `--real` switch still require `--real-hardware-ok`.

## Current Status

Works now in runtime mode:

- all supported widget fixtures validate and render
- all canned glasses workflows generate frames and JSONL logs
- peripheralctl hud --local-display --text runs the blank -> look-up -> Hermes -> dynamic result -> blank loop
- peripheralctl hud --local-display --text --hermes-cli starts in the Hermes terminal view
- peripheralctl hud --local-display --mic mac --hermes-cli can feed line-based ASR into a Hermes terminal draft; saying `Hermes` opens the voice gate, and saying `send` submits that draft without adding `send` to the prompt
- tools/openai-realtime-asr.mjs streams the Mac mic to OpenAI Realtime ASR and emits final transcripts as stdout lines for the HUD runtime
- peripheralctl asr-replay --local-display --local-hermes replays scripted transcript lines through the same HUD handler and writes text-only JSON/JSONL proof
- peripheralctl integrations exposes the sponsor matrix, agent CLI matrix, adapter operation catalog, support report, MCP manifest, phone runtime snapshot, broker timeline, glasses runtime state, and public dossier
- peripheralctl integrations sponsor-events normalizes sponsor events into AgentEvent objects, HUD widgets, and phone-routable SurfaceCommand records
- peripheralctl agent-bridge normalizes OpenClaw, Claude Code CLI, Pi, OpenCode, Gemini CLI, and Codex CLI output into AgentEvent objects and HUD widgets
- peripheralctl phone-runtime exposes the phone-owned mode manager, lease arbiter, and input router as runtime commands
- peripheralctl sponsor-workflows documents sponsor event loops, approval gates, semantic surfaces, and workflow widgets
- hudctl can show validated JSON/cards, clear runtime display state, report status, and emit manual agent status
- runtime push, clear, status, diagnostics, and latency commands work
- the driver can build the existing `0704` full-panel image envelope
- the real send path delegates transport to `macos_corebluetooth/peripheral-mac-pusher`

Production observability tracks:

- wearer-visible latency
- live transport airtime and ACK timing
- smaller 304x179 route live speed
- native/text LVGL resource backend

Read next:

- `docs/RUNTIME_COMMANDS.md` for exact walkthrough commands
- `docs/HUD_RUNTIME.md` for the real Agent HUD Runtime
- `docs/PHONE_RUNTIME.md` for the phone-owned mode, lease, and input-routing design
- `docs/PROTOCOL.md` for the documented image-push interface
- `docs/LATENCY.md` for measured runtime timing and live-test gates
- `docs/ROADMAP.md` for how this grows into broker/MCP/native UI
