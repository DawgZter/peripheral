# Integrations

The integration layer is implementation-oriented and adapter-ready. It describes what each sponsor or agent CLI contributes to Agent Mode, which credential names each runtime connector understands, which API or CLI operations are routed, and which Peripheral surface is rendered.

## Sponsor Coverage

| Sponsor | Docs | Peripheral role | HUD surfaces |
| --- | --- | --- | --- |
| AgentPhone | https://docs.agentphone.com/ | Call-control and human handoff coordinator. | Live call status, transcript chips, takeover card. |
| Stripe | https://docs.stripe.com/ | Payments, setup intents, card holds, and receipts. | Card-hold approval, receipt glance, high-risk block. |
| Supermemory | https://supermemory.ai/docs/ | Persistent memory and context retrieval. | Recall card, save approval, profile context. |
| AgentMail | https://docs.agentmail.to/ | Agent-readable inbox and outbound draft loop. | Inbox triage, draft approval, verification-code pin. |
| Browser Use | https://docs.browser-use.com/ | Browser automation telemetry and evidence. | Browser step HUD, sensitive action approval, evidence summary. |
| Sponge | https://sponge.ai/docs | Context compression and signal clustering. | Context digest, signal clusters, redaction warning. |
| Gemini | https://ai.google.dev/gemini-api/docs | Multimodal broker reasoning and routing. | Broker summary, vision summary, routing hint. |

Credential values stay outside the repo. The descriptor layer records expected names such as `AGENTPHONE_API_KEY`, `STRIPE_SECRET_KEY`, `SUPERMEMORY_API_KEY`, `AGENTMAIL_API_KEY`, `BROWSER_USE_API_KEY`, `SPONGE_API_KEY`, and `GEMINI_API_KEY`.

## Live Adapter Catalog

`peripheralctl integrations live-adapters --json` returns the adapter operation catalog. Each sponsor entry includes credential names, an API base URL, auth style, operations, broker event names, risk level, approval requirement, and target HUD surface. Each agent CLI entry includes command, aliases, session transport, credential names, launch semantics, progress stream routing, approval routing, and terminal fallback.

The catalog currently exposes 13 credential-bound adapters across AgentPhone, Stripe, Supermemory, AgentMail, Browser Use, Sponge, Gemini, OpenClaw, Claude Code CLI, Pi, OpenCode, Gemini CLI, and Codex CLI.

## Agent CLI Coverage

| Agent CLI | Command | Session transport | Peripheral surfaces |
| --- | --- | --- | --- |
| OpenClaw | `openclaw` | PTY | Progress card, approval card, terminal fallback. |
| Claude Code CLI | `claude` | tmux | Progress card, approval card, terminal fallback. |
| Pi | `pi` | adapter | Progress card, approval card, terminal fallback. |
| OpenCode | `opencode` | PTY | Progress card, approval card, terminal fallback. |
| Gemini CLI | `gemini` | stdio | Progress card, approval card, terminal fallback. |
| Codex CLI | `codex` | tmux | Progress card, approval card, terminal fallback. |

Adapters normalize CLI output into `AgentEvent` objects. The glasses see a compact semantic surface first, with raw terminal fallback only when no richer state is available. The checked-in `peripheral-hud-runtime/config/agent-bridge.json` records routing order, confirmation levels, wake names, and connected surfaces for all six CLI adapters.

## Agent Bridge

`peripheralctl agent-bridge` is the bridge surface for CLI transcript text:

- `dossier` returns adapter coverage, routing rules, sample transcript events, widgets, and safety notes.
- `adapters` lists command names, wake names, session transports, env names, and approval policy.
- `runtime-plan` returns per-agent launch commands, stdout/stderr routing, transcript audit path, phone-gateway surface routing, and approval return commands.
- `launch --agent <id> --task <text>` creates the runtime launch envelope; add `--execute` to run a process and route stdout/stderr lines into glasses surfaces.
- `transcript` emits one sample event per supported CLI.
- `session-pack` renders all six CLI adapters into glasses frames and writes a JSON audit pack for review.
- `event --agent <id> --line <text>` normalizes one bounded CLI line into an `AgentEvent` plus widget.
- `route --agent <id> --line <text>` adds the phone-owned `SurfaceCommand` and lease decision that would place the card or status surface on the glasses.
- `widget --agent <id> --line <text>` renders that widget into `out/frames/agent-bridge/`.

This is the broker-facing normalization layer that a PTY, tmux, stdio, or adapter transport can call.

Each normalized CLI event carries the same contract before it reaches the phone runtime:

| Field | Purpose |
| --- | --- |
| `kind` / `status` | Lifecycle state such as `session_started`, `session_progress`, `session_waiting`, `session_stuck`, `session_completed`, `session_error`, or `approval_required`. |
| `session_id` / `source` | Stable adapter and session identity for routing replies back to the right CLI. |
| `risk` / `choices` | Approval state and wearer choices when a CLI asks to proceed. |
| `metadata.adapter_id` / `metadata.command` / `metadata.session_model` | The CLI adapter, command, and transport model that produced the line. |
| `metadata.surface` / `metadata.decision_required` / `metadata.confirmation_level` | Intended glasses surface and confirmation posture before the phone lease decision is applied. |

Routing is intentionally small: progress, start, and completion events become glance widgets; waiting, stuck, and error events become pinned status widgets; approval requests become fullscreen approval cards with focused input.

## Sponsor Workflows

`peripheralctl sponsor-workflows` turns sponsor coverage into deterministic event loops:

- `dossier` returns every sponsor workflow, generated approval events, and inspection widgets.
- `list` shows the trigger, env names, outputs, and inspection command for each sponsor.
- `workflow <sponsor-id>` drills into one sponsor path such as `stripe` or `agentmail`.
- `widgets` renders the workflow overview and approval-gate checklist.

Each workflow declares the event trigger, target surface, risk level, phone runtime rule, and whether the user must approve before the broker continues. This makes sponsor support concrete while keeping credential values externalized and display transport behind operator/runtime gates.

## Runtime Ingest

`peripheralctl phone-runtime ingest` accepts inbound sponsor and agent payloads, normalizes them into the same `AgentEvent`, `PeripheralWidget`, and `SurfaceCommand` records used by the rest of Agent Mode, applies the phone lease arbiter, renders a glasses frame under `out/frames/phone-runtime-ingest/`, and writes an audit record.

Examples:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime ingest --sponsor agentphone --event call_connected --session-id call-check --summary "Call connected" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime ingest --payload-json '{"source":"agent","agentId":"codex_cli","sessionId":"codex-check","line":"Codex needs approval to run npm test."}' --json
```

## Sponsor Event Kit

`peripheral-hud-runtime/packages/peripheral-sponsor-kit` is the lower-level event normalizer. It maps sponsor events into three runtime objects:

- `AgentEvent` for broker/session state.
- `PeripheralWidget` for the semantic HUD renderer.
- `SurfaceCommand` for the phone-owned mode manager.

The same package now includes concrete real-world task adapters for calls, payment holds, browser tasks, context safety, broker routing, email, and memory:

- `agentphone.ts` starts and polls the restaurant call through the phone-gateway broker route.
- `stripe.ts` creates approval-gated card holds through the phone-gateway broker route.
- `browseruse.ts` starts Browser Use Cloud sessions through the phone-gateway broker route and preserves wearer approval before submit-style actions.
- `sponge.ts` posts context for wearer-safe digests and redaction warnings.
- `gemini.ts` asks Gemini for broker routing decisions that choose the glasses surface.
- `agentmail.ts` sends the confirmation email through the AgentMail adapter and phone-gateway transport.
- `supermemory.ts` saves the dinner preference through the Supermemory adapter and phone-gateway transport.

Use `peripheralctl integrations sponsor-events --json` to inspect the sample event dossier for AgentPhone, Stripe, Supermemory, AgentMail, Browser Use, Sponge, and Gemini.

## Review Commands

```sh
npm --prefix peripheral-hud-runtime run build
npm --prefix peripheral-hud-runtime run peripheralctl -- review-run --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations summary --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations sponsors --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations agent-clis --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations connected-state --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations support --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations live-adapters --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations sponsor-events --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations widgets --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge launch-specs --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge runtime-plan --agent codex_cli --session-id codex-check --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge launch --agent codex_cli --session-id codex-check --task "Run the repo checks" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge session-pack --session-prefix reviewer --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge event --agent codex_cli --line "Codex needs approval to run npm test" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge route --agent codex_cli --line "Codex needs approval to run npm test" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge widget --agent opencode --line "OpenCode is waiting on user input"
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime snapshot --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime ingest --sponsor agentphone --event call_connected --session-id call-check --summary "Call connected" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime lease --agent codex_cli --line "Codex needs approval to run npm test" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime route --line "hey codex show status" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-workflows dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-workflows workflow stripe --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime adapters --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime request --sponsor stripe --event payment_intent_requires_action --session-id stripe-check --summary "Approve card hold" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime stripe-hold --hold-amount 25.00 --currency usd --summary "Refundable dinner hold" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime agentphone-call --restaurant-phone +14155550137 --prompt "Book dinner for two and pause before confirming" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime agentmail-send --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime supermemory-save --preference "Prefers 7-8pm dinner slots" --memory-container dinner-preferences --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime followup-pack --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime browser-task --task "Check reservation availability and stop before submit" --start-url https://example.com --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime browser-task --goal "Check restaurant availability" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime sponge-context --context-text "Summarize customer context for glasses" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime gemini-route --prompt "Route this agent update to a glasses surface" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --real-agentphone --real-agentmail --real-supermemory --local-display
npm --prefix peripheral-hud-runtime run peripheralctl -- review-bundle --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-workflows widgets --json
```

The `widgets` command renders the sponsor and CLI matrices into `peripheral-hud-runtime/out/frames/integrations/`. Use `sponsor-workflows widgets` for the sponsor approval surfaces and `hud --real` when the operator is ready to drive the glasses.

## Safety Boundary

- Sponsors and agents emit semantic events, not raw BLE.
- Phone-owned mode policy decides whether a card is tiny, glance, fullscreen, pinned, delayed, or blocked.
- Payment, browser-submit, email-send, memory-save, and high-risk tool actions are approval-gated.
- The glasses runtime state reflects the phone gateway path and keeps hardware writes behind explicit operator commands.
