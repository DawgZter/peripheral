# Agent HUD Runtime

This runtime is the scrappy Mac-connected predecessor to the future Peripheral Broker. It keeps the v0 promise narrow: blank by default, reveal a compact agent HUD on look-up, launch or focus Hermes from a spoken or typed task, open a native Hermes CLI view, render paced status chunks, and switch to validated semantic widget JSON when a result exists.

It does not build the full broker, MCP server, phone relay, database, native LVGL backend, or touch input.

## Experience

1. User puts on the glasses and the runtime starts in `blank`, clears stale widget state, and sends a clear through the selected display driver.
2. A look-up event, or the typed fallback command `look_up`, shows a compact `Agent HUD`.
3. User says or types `Hermes <task>` for one-shot semantic output.
4. Or the user says or types `Hermes CLI` to open the terminal view and interact with Hermes line by line.
5. The runtime resolves Hermes from the local `PATH`.
6. If Hermes is available and real Hermes mode is selected, the semantic adapter can launch `hermes -z <prompt>`, and the terminal view can launch `hermes chat --source peripheral-hud`.
7. In mock-display mode, the runtime uses the mock Hermes adapter by default so demos do not spend tokens or touch live hardware.
8. Active Hermes mode runs in the background and renders compact CLI-style status chunks on a conservative cadence. The dedicated terminal view mirrors CLI stdout/stderr and forwards typed lines to Hermes.
9. When semantic HUD JSON appears at `.peripheral-hud/out/current-widget.json`, the runtime validates it, renders it to a monochrome full-frame image, and pushes through the selected display driver.
10. `dismiss`, `clear`, `exit`, `quit`, or `timeout` returns to `blank` and removes the active widget file so the next start cannot inherit a stale result.

## Commands

```sh
npm run peripheralctl -- hud --mock-display --text
npm run peripheralctl -- hud --mock-display --text --hermes-cli
npm run peripheralctl -- hud --mock-display --mic mac
npm run peripheralctl -- hud --real --text
npm run peripheralctl -- hud --real --mic mac
npm run peripheralctl -- hud --real --mic mac --hermes-cli --real-hermes
npm run peripheralctl -- asr-demo --mock-display --mock-hermes --script fixtures/mock_asr_demo.txt
npm run peripheralctl -- asr-demo --real --mock-hermes --framebuffer-check
npm run peripheralctl -- agents --mock
npm run peripheralctl -- agents --real

npm run hudctl -- show-json fixtures/ui/hermes_result_card.json
npm run hudctl -- show-card --title "Hermes" --body "Visual result ready"
npm run hudctl -- clear
npm run hudctl -- status
npm run hudctl -- emit-agent-status Hermes running
```

`--mock-display` is the safe default posture and never touches the live display transport. `--real` is the explicit live-display posture for the runtime and uses the full-frame image driver after the operator confirms the glasses are ready. `agents --real` only reports real local agent detection; it does not push to the display.

## Text Runtime

The easiest acceptance path is:

```sh
{
  printf "look_up\\n"
  sleep 0.2
  printf "Hermes test task\\n"
  sleep 0.9
  printf "status\\n"
  sleep 1.2
  printf "make it shorter\\n"
  sleep 0.2
  printf "exit\\n"
} | npm run peripheralctl -- hud --mock-display --text --cadence-ms 700 --json
```

Expected behavior:

- starts in `blank` and logs `state.change`
- renders compact `Agent HUD` after `look_up`
- renders `Hermes Active` launch/running cards
- accepts `status` while Hermes is still active
- writes `.peripheral-hud/out/current-widget.json`
- renders a final `Hermes Result` card
- accepts `make it shorter` after the result
- removes `.peripheral-hud/out/current-widget.json` again and exits with final state `blank`
- writes JSONL events under `out/logs/`

Interactive commands:

- `look_up`, `lookup`, or `show agents`
- `Hermes CLI`
- `Hermes <task>`
- `status`
- `details`
- `make it shorter`
- `dismiss`
- `clear`
- `exit`
- `quit`
- `timeout`

While the Hermes CLI view is open, typed text is forwarded to Hermes immediately. Voice/ASR is gated: say `Hermes` before a prompt, then say `send` to submit the current draft. Ambient voice text is ignored until that `Hermes` gate opens, and `send` closes the gate again. The `send` command is consumed by the HUD and is not included in the Hermes prompt. Use `exit cli`, `close cli`, `dismiss`, or `clear` to close just the CLI view; use `exit` or `quit` to close it and stop the HUD runtime. Use `hud` when you want to reveal the Agent HUD without killing the Hermes CLI process.

## Scripted ASR Demo

`asr-demo` is the text-first path for the future voice experience. It treats each scripted line as if it came from ASR, feeds those lines through the same transcript handler as `--mic mac`, and renders the resulting HUD states through the selected display driver. Include `Hermes CLI` in the script to exercise the terminal view; prefix voice prompts with `Hermes`, then include `send` to submit the current voice draft to Hermes; include `Hermes <task>` outside the CLI view to exercise the one-shot semantic result path. When the script ends while the terminal is open, it renders an explicit `ASR: speak a prompt draft, then say send` prompt so the glasses stay on the Hermes CLI surface.

```sh
npm run peripheralctl -- asr-demo --mock-display --mock-hermes --script fixtures/mock_asr_demo.txt --json
npm run peripheralctl -- asr-demo --mock-display --mock-hermes --asr-text "Hermes CLI|Hermes what is the HUD doing?|send|Hermes give me the next step|send" --json
```

For authorized live display checks after the display is paired and ready:

```sh
npm run peripheralctl -- asr-demo --real --mock-hermes --framebuffer-check --json
```

`--framebuffer-check` asks the local sidecar for read-only framebuffer captures before and after the scripted transcript. It reports text-only hashes and byte counts; if the sidecar is not ready, the demo still runs and the validation section is marked skipped. Script files can be newline text with optional `@wait 900` directives after transcript lines, or a JSON array of strings / `{ "text": "...", "waitMs": 900 }` objects.

## Mac Mic Input

Mac mic mode starts a transcript source from, in order, --stt-cmd, PERIPHERAL_HUD_STT_CMD, OpenAI Realtime ASR when an OpenAI key is configured, then the bundled macOS Speech helper at tools/bin/PeripheralMacASR.app/Contents/MacOS/peripheral-mac-asr or tools/macos-speech-asr/MacSpeechAsr.swift. That command must emit completed transcript lines on stdout, one command per line. Leave off `--hermes-cli` for the always-listening wake flow: saying `open Hermes` opens the CLI view, saying `close Hermes` blanks it, and saying `Hermes <prompt>` starts drafting while the CLI is open.

Example shape:

```sh
PERIPHERAL_HUD_STT_CMD="/path/to/stt-helper --line-mode" npm run peripheralctl -- hud --mock-display --mic mac
npm run peripheralctl -- hud --mock-display --mic mac --hermes-cli --mock-hermes --stt-cmd "printf 'voice test prompt\\n'"
```

For the preferred live voice-to-Hermes path, use OpenAI Realtime ASR. The helper streams PCM16 Mac mic audio over the Realtime transcription WebSocket, defaults to `gpt-realtime-whisper`, uses the legacy session payload for `gpt-realtime-*` models, and emits only completed transcript lines to stdout:

```sh
npm run peripheralctl -- hud --real --mic mac --asr-provider openai-realtime --real-hermes --asr-locale en
npm run peripheralctl -- hud --real --mic mac --asr-provider openai-realtime --hermes-cli --real-hermes --asr-duration-seconds 30
node tools/openai-realtime-asr.mjs --self-test
node tools/openai-realtime-asr.mjs --list-devices
```

The helper reads `OPENAI_API_KEY` from the environment, `OPENAI_ENV_FILE`, `.env` in this package, or the repository root `.env`. Override the default model with `OPENAI_PERIPHERAL_ASR_MODEL`, `--openai-asr-model gpt-4o-transcribe`, or force the current docs payload with `--openai-asr-protocol current`. OpenAI Realtime ASR now passes an English language hint by default; override it with `--asr-locale <code>` or `OPENAI_REALTIME_ASR_LANGUAGE`. The Mac mic input defaults to auto-detection, preferring the MacBook microphone over aggregate/virtual devices.

If OpenAI Realtime is not desired, force the local Apple Speech helper:

```sh
./tools/build-macos-speech-asr.sh
npm run peripheralctl -- hud --real --mic mac --asr-provider macos-speech --hermes-cli --real-hermes --asr-locale en-US
npm run peripheralctl -- hud --real --mic mac --hermes-cli --real-hermes --asr-http-port 8792
```

When the glasses are paired, the wake flow keeps the display blank until `open Hermes` is heard. Once the CLI is open, voice transcripts are ignored until a line begins with `Hermes`; that line opens an `ASR draft` on the glasses. Say `send` to write the draft into `hermes chat --source peripheral-hud`; the word `send` is not included in the prompt, and the gate resets after sending. Say `close Hermes` to close the CLI and blank the display. Use --asr-silence-ms 900 to make stable partials emit faster, --asr-partials to log partial recognition to stderr/JSONL, or --asr-duration-seconds 30 for bounded tests.

If local mic permission is awkward from the Codex-launched helper, use the browser fallback only as a transport bridge: start with --asr-http-port 8792, open http://127.0.0.1:8792/, click Start, and allow microphone permission in the browser. Final browser speech transcripts update the same queued Hermes/glasses draft, and `send` submits it, but this is not the preferred GPT Realtime ASR path.

No touch input is required for v0.

## Hermes Adapter

The runtime resolves Hermes from the local `PATH`:

```sh
which hermes
```

When real Hermes mode is selected and Hermes is installed, the adapter launches:

```sh
hermes -z "<HUD JSON prompt>"
```

The prompt asks Hermes to return only one semantic widget object. Supported visual result types include `generic_card`, `table`, and `checklist`. The runtime also sets `PERIPHERAL_HUD_WIDGET_PATH=.peripheral-hud/out/current-widget.json` so a future Hermes wrapper can write the result directly. The watcher validates that file before rendering.

The Hermes process is launched as a background runtime task. While it is active, text or transcript commands can still show status/details, shorten the latest visible result, or dismiss the HUD surface. Dismissing does not try to kill Hermes in v0; it suppresses later display updates from that run and logs the suppressed result.

## Hermes CLI View

The terminal view is the default interactive Hermes surface for demos where you want to see the actual CLI-style conversation in the glasses instead of only a summarized card.

```sh
npm run peripheralctl -- hud --mock-display --text --hermes-cli
npm run peripheralctl -- hud --real --text --real-hermes --hermes-cli
```

`--hermes-cli` opens the `terminal` widget immediately. The same view can be opened later by typing or saying `open Hermes`, `Hermes CLI`, `hermes terminal`, `terminal`, or `cli` in the runtime. In mock Hermes mode the runtime renders deterministic fake CLI replies. In real Hermes mode it spawns `hermes chat --source peripheral-hud`, mirrors stdout/stderr into the `terminal` widget, and writes typed lines to the child process stdin. ASR lines are ignored until the user says `Hermes`, then they stay in a draft buffer until the user says `send`; `close Hermes` closes the CLI view and blanks the display.

In mock-display mode the adapter defaults to mock Hermes, even if Hermes is installed. This keeps local acceptance deterministic and safe while the glasses are in live use. Use `--real-hermes` only when you intentionally want the local Hermes process to run.

## State And Logs

Runtime states:

- `blank`
- `agent_hud`
- `active_agent`
- `terminal`
- `dynamic_result`
- `error`

Agent statuses:

- `idle`
- `launching`
- `running`
- `waiting`
- `needs_attention`
- `completed`
- `error`

Runtime files:

- `.peripheral-hud/out/state.json`
- `.peripheral-hud/out/agent-status.json`
- `.peripheral-hud/out/current-widget.json` while a semantic result is active
- `out/frames/runtime/*.png`
- `out/logs/*.jsonl`

JSONL logs include state changes, text or transcript commands, agent status changes, render timing, push timing, dynamic widget events, active-widget clears, and clean runtime exits.

## Safety

Agents never generate transport packets or arbitrary screenshots. They may produce semantic widget JSON only. The renderer and driver deterministically convert validated widgets into full-frame monochrome images. Nested widget data is validated before rendering, including transcript bubbles, people rows, choices, tables, and checklist items.

The runtime keeps using the proven full-frame image path first. Update cadence defaults to 1400 ms, matching `docs/LATENCY.md` conservative guidance until live transport measurements prove a lower cadence. Real runtime display commands are implemented behind the explicit `--real` switch; legacy image-push commands still require `--real-hardware-ok`.

`PERIPHERAL_HUD_SKIP_SURFACE_SETUP=1` keeps one initial full-panel surface resync but skips the readiness wait for that resync; later pushes skip setup after a successful first send. Use `PERIPHERAL_HUD_SKIP_SURFACE_SETUP=always` only for deliberate setup-skipped experiments. With the variable unset, the driver keeps the conservative readiness wait.

Run live display checks only when explicitly authorized; use the mock capture gate below for source-level verification.

The fastest local gate is:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- live-check --mock --capture --json
```

That command uses the mock display driver but the `--capture` portion still asks the local sidecar for read-only live display bytes when the bridge is ready.
