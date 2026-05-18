# Demo

Everything here can run without glasses by passing `--mock`.

For the live Agent HUD Runtime, see `docs/HUD_RUNTIME.md`.

## Install And Build

```sh
cd peripheral-hud-runtime
npm install
npm run build
npm test
```

## Schema

The v0 schema is transport-independent widget JSON. Supported types:

- `live_call`
- `strategy_card`
- `people_list`
- `person_detail`
- `approval_card`
- `status_icon`
- `generic_card`
- `table`
- `checklist`

Common fields include `id`, `type`, `title`, `status`, `body`, `bullets`, `left_image`, `icon`, `primary`, `action`, `choices`, `footer`, `source`, and `created_at`. Type-specific fields include `transcript`, `facts`, `player_hand`, `dealer_card`, `people`, `columns`, `rows`, and `items`.

Unknown widget types are rejected. Use `generic_card` for explicit fallback behavior. Text is normalized and truncated before rendering so fixtures stay safe for a small HUD.

## Render And Mock Push

```sh
npm run peripheralctl -- render-json fixtures/ui/generic_card.json --out out/frames/generic_card.png
npm run peripheralctl -- push-json fixtures/ui/generic_card.json --mock
npm run peripheralctl -- show-image out/frames/generic_card.png --mock
```

`render-json` writes a PNG and a `.frame.json` sidecar. Real pushes require that sidecar because the driver sends packed 2 bpp pixels, not arbitrary screenshots.

## Canned Demos

Live restaurant call HUD:

```sh
npm run peripheralctl -- demo live-call --mock
```

Blackjack strategy HUD:

```sh
npm run peripheralctl -- demo blackjack --mock
```

Conference people HUD:

```sh
npm run peripheralctl -- demo conference --mock
```

Agent cockpit approval mini-flow:

```sh
npm run peripheralctl -- demo agent --mock
```

Sponsor and agent CLI matrix:

```sh
npm run peripheralctl -- integrations summary --json
npm run peripheralctl -- integrations connected-state --json
npm run peripheralctl -- integrations readiness --json
npm run peripheralctl -- integrations mcp-manifest --json
npm run peripheralctl -- integrations broker-timeline --json
npm run peripheralctl -- integrations dossier --json
npm run peripheralctl -- integrations widgets --json
npm run peripheralctl -- demo integrations --mock
```

Each demo writes sequential frames to `out/frames/demo-<name>-<timestamp>/` and JSONL events to `out/logs/`.

## Scripted ASR

Replay transcript lines through the HUD runtime without using a mic or live display:

```sh
npm run peripheralctl -- asr-demo --mock-display --mock-hermes --asr-text "Hermes CLI|Hermes what is the HUD doing?|send|Hermes give me the next step|send" --json
```

The command writes JSON plus JSONL events for transcript input, state changes, rendered frames, and the final demo summary. Add `--framebuffer-check` only with `--real` and explicit operator permission when you want before/after read-only framebuffer hashes from the local sidecar.

For real Mac mic input into the Hermes terminal, start the live HUD runtime with OpenAI Realtime ASR:

```sh
npm run peripheralctl -- hud --real --mic mac --asr-provider openai-realtime --hermes-cli --real-hermes --asr-locale en-US
npm run peripheralctl -- hud --real --mic mac --hermes-cli --real-hermes --asr-http-port 8792
```

## Latency

Mock latency measurement:

```sh
npm run peripheralctl -- measure-latency --mock
```

Real hardware latency measurement is intentionally gated:

```sh
npm run peripheralctl -- measure-latency --real-hardware-ok
```

Only run the real command after asking the operator and confirming the glasses are ready. It will push several full-panel frames through the existing Mac helper.

## Diagnostics

```sh
npm run peripheralctl -- status --mock
npm run peripheralctl -- diagnostics --mock
npm run peripheralctl -- clear --mock
```

`status --mock` confirms the helper path and configured display constants without touching the live display transport.

## Real Glasses Push

The real path wraps:

```text
macos_corebluetooth/peripheral-mac-pusher/.build/manual/peripheral-mac-pusher --stdin --with-response
```

A real push is the same CLI without `--mock`, for example:

```sh
npm run peripheralctl -- push-json fixtures/ui/generic_card.json --real-hardware-ok
```

Do not run that while the glasses are in use without explicit permission. The current pass did not perform a live display send. The same explicit flag is required for real `show-image`, `clear`, and `demo` commands.
