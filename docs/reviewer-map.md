# Reviewer Map

Review Peripheral as a dinner-booking control surface first, then as a general adapter catalog.

## Fastest Review Path

```sh
npm --prefix peripheral-hud-runtime ci
npm run check
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local --json
```

Expected artifacts:

- `peripheral-hud-runtime/out/frames/dinner-booking/`
- `peripheral-hud-runtime/out/demo/dinner-booking-timeline.json`
- `peripheral-hud-runtime/out/logs/dinner-booking.jsonl`

## Single Flow

| Step | Proof label | Where to inspect |
| --- | --- | --- |
| User asks for dinner | Review input | `peripheral-hud-runtime/fixtures/dinner_booking_walkthrough.json` |
| AgentPhone starts call | Adapter path | `peripheral-hud-runtime/packages/peripheral-sponsor-kit/src/agentphone.ts` |
| Transcript reaches glasses | Implemented | `peripheralctl demo dinner-booking --local --json` |
| Booking pauses for approval | Implemented | `out/frames/dinner-booking/04-approval-required.png` |
| User decision changes flow | Implemented | `phone-runtime decide --event booking-approval-1 --choice approve` |
| Follow-up adapters dispatch | Adapter path | AgentMail and Supermemory dispatch records in `dinner-booking-timeline.json` |

## Real Mode Env Surface

| Area | Env names |
| --- | --- |
| AgentPhone | `AGENTPHONE_API_KEY`, `AGENTPHONE_API_URL` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_API_URL`, `STRIPE_CUSTOMER_ID` |
| AgentMail | `AGENTMAIL_API_KEY`, `AGENTMAIL_API_URL`, `AGENTMAIL_TO`, `AGENTMAIL_FROM` |
| Supermemory | `SUPERMEMORY_API_KEY`, `SUPERMEMORY_API_URL`, `SUPERMEMORY_CONTAINER` |
| Display transport | `PERIPHERAL_MAC_NAME_PREFIX`, `PERIPHERAL_HUD_SKIP_SURFACE_SETUP` |

## Architecture Proof Points

| Area | Where to inspect |
| --- | --- |
| Phone-owned surface runtime | `peripheral-hud-runtime/packages/peripheral-phone-runtime/src/index.ts` |
| Peripheral hardware profile | `docs/peripheral-glasses.md` and `peripheralctl integrations hardware-profile --json` |
| Agent Mode protocol | `peripheral-hud-runtime/packages/peripheral-protocol/src/index.ts` |
| Sponsor registry | `peripheral-hud-runtime/packages/peripheral-integrations/src/index.ts` |
| Sponsor event kit | `peripheral-hud-runtime/packages/peripheral-sponsor-kit/src/index.ts` |
| CLI transcript normalization | `peripheral-hud-runtime/packages/peripheral-agent-bridge/src/index.ts` |
| Smoke coverage | `peripheral-hud-runtime/tests/renderer-smoke.test.ts` |

## Safety Boundary

- Agents and sponsors emit semantic events, not transport packets.
- The phone owns BLE, renderer state, input capture, and display leases.
- Payment, browser submit, email send, memory save, and high-risk tool actions are approval gated.
- Real display transport is explicit and operator controlled.
