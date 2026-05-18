# Peripheral

[![Check](https://github.com/DawgZter/peripheral/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/DawgZter/peripheral/actions/workflows/check.yml?query=branch%3Amain)

Smart-glasses control surface for real-world AI agents.

Peripheral is both the glasses and the runtime around them. The hardware was built in Shenzhen as an agent-first pair of display smart glasses: 28g, microLED, binocular waveguide displays, 12-24 hours of battery life depending on operating mode, and an optical stack designed for extremely low light leakage. At 28g, Peripheral is built to be the lightest display smart-glasses form factor in the world.

The point is not to make another phone screen. Peripheral is a lightweight display peripheral for agents that can call, browse, email, pay, remember, ask for approval, and keep the wearer in control while work happens in the real world. In our view, that is the best shape for smart glasses in an agent-native world: barely there until an agent needs your eyes, your context, or your consent.

Peripheral makes an agent's work visible, interruptible, and approval-gated on glasses. The core proof is a dinner-booking workflow: an agent starts a restaurant call through AgentPhone, the glasses show call status and transcript, a reservation time pauses behind a wearer approval card, then AgentMail and Supermemory follow-up surfaces appear after approval.

## 60 Second Demo

```sh
npm --prefix peripheral-hud-runtime ci
npm run check
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local --json
```

Artifacts:

- `peripheral-hud-runtime/out/frames/dinner-booking/`
- `peripheral-hud-runtime/out/demo/dinner-booking-timeline.json`
- `peripheral-hud-runtime/out/logs/dinner-booking.jsonl`

Use manual approval mode when you want the run to stop at the card:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local --wait-for-approval
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime decide --event booking-approval-1 --choice approve
```

## What It Proves

- AgentPhone call events become glasses HUD updates.
- Human approval gates a consequential real-world action.
- AgentMail and Supermemory follow-up events are rendered on glasses.
- Agents never write pixels or BLE packets directly.
- The phone/runtime owns surface leases, input focus, rendering, and safety.

## Real Mode

Set credentials outside the repo:

```sh
export AGENTPHONE_API_KEY=...
export AGENTMAIL_API_KEY=...
export SUPERMEMORY_API_KEY=...
```

Then run the same flow with the AgentPhone path enabled while keeping display output local unless the operator explicitly chooses real glasses transport:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --real-agentphone --real-agentmail --local-display
```

## Sponsor Status

| Sponsor | Status |
| --- | --- |
| AgentPhone | Real adapter path plus local fallback for dinner booking |
| AgentMail | Confirmation approval surface plus optional configured dispatch path |
| Supermemory | Save-memory surface for dinner preference |
| Stripe | Approval/risk surface for card holds and payment checkpoints |
| Browser Use | Evidence and sensitive-action surface |
| Sponge | Context and redaction surface |
| Gemini | Routing and summary surface |

## Repo Layout

- `peripheral-hud-runtime/` contains the Agent HUD runtime, renderer, CLI, sponsor adapters, phone runtime, and dinner-booking command.
- `macos_corebluetooth/peripheral-mac-pusher/` contains the macOS helper for authorized real display pushes.
- `docs/` contains architecture, reviewer, integration, protocol, and development notes.

## Safety Boundary

Agents and sponsors emit semantic events. The broker and phone runtime decide whether those become tiny HUDs, glance cards, fullscreen approvals, pinned status, or blocked requests. Real display transport remains operator-gated.
