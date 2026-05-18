# Runtime Commands

The runtime path uses `--local` to render, log, and inspect frames while live display transport stays behind explicit operator approval.

For the live Agent HUD Runtime, see `docs/HUD_RUNTIME.md`.

## Build

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

## Render And Local Review Push

```sh
npm run peripheralctl -- render-json fixtures/ui/generic_card.json --out out/frames/generic_card.png
npm run peripheralctl -- push-json fixtures/ui/generic_card.json --local
npm run peripheralctl -- show-image out/frames/generic_card.png --local
```

`render-json` writes a PNG and a `.frame.json` sidecar. Real pushes require that sidecar because the driver sends packed 2 bpp pixels, not arbitrary screenshots.

## Glasses Workflows

Live restaurant call HUD:

```sh
npm run peripheralctl -- walkthrough live-call --local
```

Blackjack strategy HUD:

```sh
npm run peripheralctl -- walkthrough blackjack --local
```

Conference people HUD:

```sh
npm run peripheralctl -- walkthrough conference --local
```

Agent cockpit approval mini-flow:

```sh
npm run peripheralctl -- walkthrough agent --local
```

Connected Agent Mode walkthrough:

```sh
npm run peripheralctl -- render-json fixtures/ui/agent_mode_connected_status.json --out out/frames/agent-mode-connected-status.png
npm run peripheralctl -- render-json fixtures/ui/agent_mode_sponsor_cards.json --out out/frames/agent-mode-sponsor-cards.png
npm run peripheralctl -- render-json fixtures/ui/agent_mode_cli_status.json --out out/frames/agent-mode-cli-status.png
npm run peripheralctl -- render-json fixtures/ui/agent_mode_approval_gate.json --out out/frames/agent-mode-approval-gate.png
```

See `docs/AGENT_MODE_RUNBOOK.md` for the connected-state storyboard.

Sponsor and agent CLI matrix:

```sh
npm run peripheralctl -- integrations summary --json
npm run peripheralctl -- integrations connected-state --json
npm run peripheralctl -- integrations support --json
npm run peripheralctl -- integrations live-adapters --json
npm run peripheralctl -- integrations mcp-manifest --json
npm run peripheralctl -- integrations broker-timeline --json
npm run peripheralctl -- integrations phone-runtime --json
npm run peripheralctl -- integrations dossier --json
npm run peripheralctl -- integrations widgets --json
npm run peripheralctl -- walkthrough integrations --local
npm run peripheralctl -- agent-bridge event --agent codex_cli --session-id codex-check --line "Codex needs approval to run npm test" --json
npm run peripheralctl -- agent-bridge widget --agent claude_code --line "Claude Code is 40% complete" --json
npm run peripheralctl -- phone-runtime snapshot --json
npm run peripheralctl -- phone-runtime route --line "hey codex show status" --json
npm run peripheralctl -- sponsor-workflows dossier --json
npm run peripheralctl -- sponsor-workflows widgets --json
```

Each walkthrough writes sequential frames to `out/frames/walkthrough-<name>-<timestamp>/` and JSONL events to `out/logs/`.

## Scripted ASR

Replay transcript lines through the HUD runtime with runtime display transport:

```sh
npm run peripheralctl -- asr-replay --local-display --local-hermes --asr-text "Hermes CLI|Hermes what is the HUD doing?|send|Hermes give me the next step|send" --json
```

The command writes JSON plus JSONL events for transcript input, state changes, rendered frames, and the final walkthrough summary. Add `--framebuffer-check` only with `--real` and explicit operator permission when you want before/after read-only framebuffer hashes from the local sidecar.

For real Mac mic input into the Hermes terminal, start the live HUD runtime with OpenAI Realtime ASR:

```sh
npm run peripheralctl -- hud --real --mic mac --asr-provider openai-realtime --hermes-cli --real-hermes --asr-locale en-US
npm run peripheralctl -- hud --real --mic mac --hermes-cli --real-hermes --asr-http-port 8792
```

## Latency

Local latency measurement:

```sh
npm run peripheralctl -- measure-latency --local
```

Real glasses latency measurement is operator-gated:

```sh
npm run peripheralctl -- measure-latency --real-hardware-ok
```

Only run the real command after asking the operator and confirming the glasses are ready. It will push several full-panel frames through the existing Mac helper.

## Diagnostics

```sh
npm run peripheralctl -- status --local
npm run peripheralctl -- diagnostics --local
npm run peripheralctl -- clear --local
```

`status --local` confirms the helper path and configured display constants while live display transport remains gated.

## Real Glasses Push

The real path wraps:

```text
macos_corebluetooth/peripheral-mac-pusher/.build/manual/peripheral-mac-pusher --stdin --with-response
```

A real push uses the operator-confirmed transport flag, for example:

```sh
npm run peripheralctl -- push-json fixtures/ui/generic_card.json --real-hardware-ok
```

Use the real path only after explicit operator permission and a ready display. The same explicit flag is required for real `show-image`, `clear`, and `walkthrough` commands.
