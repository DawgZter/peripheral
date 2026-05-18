# Peripheral

[![Check](https://github.com/DawgZter/peripheral/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/DawgZter/peripheral/actions/workflows/check.yml?query=branch%3Amain)

Agent-first smart glasses for real-world AI agents.

Peripheral started as hardware I built in Shenzhen because agents needed a better output device than a laptop window or another phone notification. The glasses are a 28g, microLED, binocular-waveguide display system with 12-24 hours of battery life depending on operating mode and an optical stack tuned for extremely low light leakage. At 28g, Peripheral is built to be the lightest display smart-glasses form factor in the world.

The hardware matters because Peripheral is not trying to become another phone screen. It is a wearable peripheral for your agents: light enough to keep on all day, private enough for public spaces, bright enough for glanceable work, and simple enough that the phone/runtime can own safety, rendering, and approvals. In my view, this is the strongest shape for smart glasses in an agent-native world: barely there until an agent needs your eyes, your context, or your consent.

Peripheral makes an agent's work visible, interruptible, and approval-gated on glasses. The core proof is a dinner-booking workflow: an agent starts a restaurant call through AgentPhone, the glasses show call status and transcript, a reservation time pauses behind a wearer approval card, then AgentMail and Supermemory follow-up surfaces appear after approval.

## 60 Second Demo

```sh
npm --prefix peripheral-hud-runtime ci
npm run check
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local --json
npm --prefix peripheral-hud-runtime run peripheralctl -- review-run --json
npm --prefix peripheral-hud-runtime run peripheralctl -- review-bundle --json
npm --prefix peripheral-hud-runtime run peripheralctl -- live-proof dinner-booking --real-hardware-ok --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge session-pack --session-prefix reviewer --json
```

`review-run` generates the dinner-booking frames, the six-agent CLI frame pack, all-sponsor runtime frames, post-approval sponsor follow-up frames, and a single evidence index. `review-bundle` checks the rendered frames, timeline, log, MP4, adapter catalog, and support report, then embeds connected-state, phone-runtime, agent-bridge, and `liveProof` summaries for operator-driven glasses access.

Artifacts:

- `peripheral-hud-runtime/out/frames/dinner-booking/`
- `peripheral-hud-runtime/out/demo/dinner-booking-timeline.json`
- `peripheral-hud-runtime/out/logs/dinner-booking.jsonl`
- `peripheral-hud-runtime/out/demo/dinner-booking-live-proof.json`
- `peripheral-hud-runtime/out/frames/agent-bridge-session/`
- `peripheral-hud-runtime/out/agent-bridge/session-pack.json`
- `peripheral-hud-runtime/out/frames/sponsor-followup/`
- `peripheral-hud-runtime/out/sponsor-runtime/followup-pack.json`
- `peripheral-hud-runtime/out/frames/sponsor-runtime-evidence/`
- `peripheral-hud-runtime/out/sponsor-runtime/evidence-pack.json`
- `peripheral-hud-runtime/out/review/evidence-index.json`
- `docs/media/peripheral-demo-dinner-booking.mp4`

Use manual approval mode when you want the run to stop at the card:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local --wait-for-approval
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime decide --event booking-approval-1 --choice approve
```

For direct runtime inspection, the same bundle points at these commands:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations connected-state --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations support --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations live-adapters --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime dinner-followups --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime snapshot --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime approval-policy --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime evaluate-decision --risk high --confirmation voice --choice approve --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime ingest --sponsor agentphone --event call_connected --session-id call-check --summary "Call connected" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- live-proof dinner-booking --real-hardware-ok --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime agentphone-call --restaurant-phone +14155550137 --prompt "Book dinner for two and pause before confirming" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime agentmail-send --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime supermemory-save --preference "Prefers 7-8pm dinner slots" --memory-container dinner-preferences --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime followup-pack --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime evidence-pack --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge route --agent codex_cli --session-id review-bundle --line "Codex needs approval to run npm test." --json
```

## What It Proves

For hardware context, see `docs/peripheral-glasses.md`; the same profile is exposed by `peripheralctl integrations hardware-profile --json`.

- AgentPhone call events become glasses HUD updates.
- Inbound sponsor and agent events can be ingested, rendered, lease-checked, and logged by the phone runtime.
- Human approval gates a consequential real-world action.
- Low, medium, and high-risk approvals are evaluated by the phone runtime before an external action can continue.
- AgentMail and Supermemory follow-up events are rendered on glasses.
- Agents never write pixels or BLE packets directly.
- The phone/runtime owns surface leases, input focus, rendering, and safety.

## Real Mode

Set credentials outside the repo:

```sh
export AGENTPHONE_API_KEY=...
export AGENTMAIL_API_KEY=...
export SUPERMEMORY_API_KEY=...
export STRIPE_SECRET_KEY=...
export BROWSER_USE_API_KEY=...
export SPONGE_API_KEY=...
export GEMINI_API_KEY=...
# optional endpoint/target overrides:
# export STRIPE_API_URL=...
# export BROWSER_USE_API_URL=...
# export SPONGE_API_URL=...
# export GEMINI_API_URL=...
# export AGENTMAIL_API_URL=...
# export AGENTMAIL_TO=...
# export SUPERMEMORY_API_URL=...
# export SUPERMEMORY_CONTAINER=...
```

Then run the same flow with the AgentPhone, AgentMail, and Supermemory adapter paths enabled while keeping display output local unless the operator explicitly chooses real glasses transport:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --real-agentphone --real-agentmail --real-supermemory --local-display
npm --prefix peripheral-hud-runtime run peripheralctl -- live-proof dinner-booking --real-hardware-ok --json
```

To inspect the AgentMail and Supermemory follow-up payloads, credential binding names, and glasses approval surfaces before any provider call:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime dinner-followups --json
```

For single sponsor-runtime probes, `--real-sponsor` or the adapter-specific flag such as `--real-agentmail`, `--real-supermemory`, `--real-stripe`, `--real-browser-use`, `--real-sponge`, or `--real-gemini` switches from phone-gateway review mode to the credential-bound provider adapter.

## Sponsor Status

| Sponsor | Status |
| --- | --- |
| AgentPhone | Credential-bound call path plus phone-gateway broker route for dinner booking |
| AgentMail | Credential-bound confirmation-send adapter path with phone-gateway transport |
| Supermemory | Credential-bound preference-save adapter path with phone-gateway transport |
| Stripe | Credential-bound card-hold adapter path plus approval/risk surface |
| Browser Use | Credential-bound browser task adapter plus approval-gated evidence surface |
| Sponge | Credential-bound context adapter plus redaction and digest surface |
| Gemini | Credential-bound broker routing adapter plus summary surface |

## Repo Layout

- `peripheral-hud-runtime/` contains the Agent HUD runtime, renderer, CLI, sponsor adapters, phone runtime, and dinner-booking command.
- `macos_corebluetooth/peripheral-mac-pusher/` contains the macOS helper for authorized real display pushes.
- `docs/` contains architecture, reviewer, integration, protocol, and development notes.
- `docs/peripheral-glasses.md` captures the hardware profile and why Peripheral is designed as an agent peripheral.

## Safety Boundary

Agents and sponsors emit semantic events. The broker and phone runtime decide whether those become tiny HUDs, glance cards, fullscreen approvals, pinned status, or blocked requests. Real display transport remains operator-gated.
