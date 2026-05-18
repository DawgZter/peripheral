# Reviewer Map

Review Peripheral as a dinner-booking control surface first, then as a general adapter catalog.

## Fastest Review Path

```sh
npm --prefix peripheral-hud-runtime ci
npm run check
npm --prefix peripheral-hud-runtime run peripheralctl -- review-run --json
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local
npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local --json
npm --prefix peripheral-hud-runtime run peripheralctl -- review-bundle --json
npm --prefix peripheral-hud-runtime run peripheralctl -- live-proof dinner-booking --json
```

The review bundle returns both artifact checks and runtime evidence: connected-state, phone-runtime, agent-bridge, and `liveProof` route summaries are embedded in the same JSON. `live-proof` is the glasses-first operator path for AgentPhone, AgentMail, Supermemory, and real display transport; `review-bundle` inspects the saved service/display record while the operator proof command performs the service/display run.

Expected artifacts:

- `peripheral-hud-runtime/out/frames/dinner-booking/`
- `peripheral-hud-runtime/out/demo/dinner-booking-timeline.json`
- `peripheral-hud-runtime/out/logs/dinner-booking.jsonl`
- `peripheral-hud-runtime/out/frames/sponsor-followup/`
- `peripheral-hud-runtime/out/sponsor-runtime/followup-pack.json`
- `peripheral-hud-runtime/out/frames/sponsor-runtime-evidence/`
- `peripheral-hud-runtime/out/sponsor-runtime/evidence-pack.json`
- `peripheral-hud-runtime/out/review/evidence-index.json`
- `peripheral-hud-runtime/out/demo/dinner-booking-live-proof.json`
- `docs/media/peripheral-demo-dinner-booking.mp4`

## Single Flow

| Step | Proof label | Where to inspect |
| --- | --- | --- |
| User asks for dinner | Review input | `peripheral-hud-runtime/fixtures/dinner_booking_walkthrough.json` |
| AgentPhone starts call | Adapter path | `peripheral-hud-runtime/packages/peripheral-sponsor-kit/src/agentphone.ts` |
| Transcript reaches glasses | Implemented | `peripheralctl demo dinner-booking --local --json` |
| Booking pauses for approval | Implemented | `out/frames/dinner-booking/04-approval-required.png` |
| User decision changes flow | Implemented | `phone-runtime decide --event booking-approval-1 --choice approve` |
| Follow-up adapters dispatch | Adapter path | AgentMail and Supermemory dispatch records in `dinner-booking-timeline.json` |
| End-to-end evidence envelope | Implemented | `peripheralctl live-proof dinner-booking --json` |
| Proof bundle verifies artifacts and runtime evidence | Implemented | `peripheralctl review-bundle --json` |

## Runtime Evidence

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations connected-state --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations support --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations live-adapters --json
npm --prefix peripheral-hud-runtime run peripheralctl -- review-run --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime dinner-followups --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime snapshot --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime approval-policy --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime evaluate-decision --risk high --confirmation voice --choice approve --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime ingest --sponsor agentphone --event call_connected --session-id call-check --summary "Call connected" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- live-proof dinner-booking --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime agentphone-call --restaurant-phone +14155550137 --prompt "Book dinner for two and pause before confirming" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime agentmail-send --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime supermemory-save --preference "Prefers 7-8pm dinner slots" --memory-container dinner-preferences --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime followup-pack --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime evidence-pack --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge route --agent codex_cli --session-id review-bundle --line "Codex needs approval to run npm test." --json
```

The support and live-adapter reports expose 14 supported integration records, 14 live-ready adapters, and 51 cataloged operations; secret values stay outside the repo while the reports name the external runtime bindings. The adapter totals, connected-state, phone-runtime, agent-bridge route summaries, and last-run service/display proof are embedded under `runtime` in `review-bundle --json`.

## Real Mode Env Surface

| Area | Env names |
| --- | --- |
| AgentPhone | `AGENTPHONE_API_KEY`, `AGENTPHONE_API_URL` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_API_URL`, `STRIPE_CUSTOMER_ID` |
| Sponge | `SPONGE_API_KEY`, `SPONGE_API_URL`, `SPONGE_PROJECT_ID` |
| Moss | `MOSS_API_KEY`, `MOSS_API_URL`, `MOSS_WORKSPACE_ID` |
| Gemini | `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_URL`, `GEMINI_MODEL` |
| AgentMail | `AGENTMAIL_API_KEY`, `AGENTMAIL_API_URL`, `AGENTMAIL_TO`, `AGENTMAIL_FROM` |
| Supermemory | `SUPERMEMORY_API_KEY`, `SUPERMEMORY_API_URL`, `SUPERMEMORY_CONTAINER` |
| Browser Use | `BROWSER_USE_API_KEY`, `BROWSER_USE_API_URL`, `BROWSER_USE_PROFILE_ID`, `BROWSER_USE_WORKSPACE_ID` |
| Display transport | `PERIPHERAL_MAC_NAME_PREFIX`, `PERIPHERAL_HUD_SKIP_SURFACE_SETUP` |

## Architecture Proof Points

| Area | Where to inspect |
| --- | --- |
| Phone-owned surface runtime | `peripheral-hud-runtime/packages/peripheral-phone-runtime/src/index.ts` |
| One-command evidence pack | `peripheralctl review-run --json` |
| Approval policy enforcement | `peripheralctl phone-runtime evaluate-decision --risk high --confirmation voice --choice approve --json` |
| Inbound runtime ingest | `peripheralctl phone-runtime ingest --sponsor agentphone --event call_connected --json` |
| AgentPhone call adapter | `peripheralctl sponsor-runtime agentphone-call --restaurant-phone +14155550137 --prompt "Book dinner for two and pause before confirming" --json` |
| AgentMail send adapter | `peripheralctl sponsor-runtime agentmail-send --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim --json` |
| Supermemory save adapter | `peripheralctl sponsor-runtime supermemory-save --preference "Prefers 7-8pm dinner slots" --memory-container dinner-preferences --json` |
| Follow-up sponsor frames | `peripheralctl sponsor-runtime followup-pack --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim --json` |
| Live proof envelope | `peripheralctl live-proof dinner-booking --json` |
| All sponsor runtime frames | `peripheralctl sponsor-runtime evidence-pack --json` |
| Peripheral hardware profile | `docs/peripheral-glasses.md` and `peripheralctl integrations hardware-profile --json` |
| Agent Mode protocol | `peripheral-hud-runtime/packages/peripheral-protocol/src/index.ts` |
| Sponsor registry | `peripheral-hud-runtime/packages/peripheral-integrations/src/index.ts` |
| Sponsor event kit | `peripheral-hud-runtime/packages/peripheral-sponsor-kit/src/index.ts` |
| Browser/Sponge/Moss/Gemini adapters | `peripheral-hud-runtime/packages/peripheral-sponsor-kit/src/browseruse.ts`, `sponge.ts`, `moss.ts`, `gemini.ts` |
| Moss/Sponge/Stripe combined path | `peripheralctl sponsor-runtime moss-sponge-stripe --hold-amount 25.00 --currency usd --json` |
| CLI transcript normalization | `peripheral-hud-runtime/packages/peripheral-agent-bridge/src/index.ts` |
| Agent CLI runtime plan | `peripheralctl agent-bridge runtime-plan --agent codex_cli --session-id codex-check --json` |
| Agent CLI executable route | `peripheralctl agent-bridge launch --agent codex_cli --session-id codex-check --task "Run checks" --json` |
| Agent CLI glasses frames | `peripheralctl agent-bridge session-pack --session-prefix reviewer --json` |
| Smoke coverage | `peripheral-hud-runtime/tests/renderer-smoke.test.ts` |

## Safety Boundary

- Agents and sponsors emit semantic events, not transport packets.
- The phone owns BLE, renderer state, input capture, and display leases.
- Payment, browser submit, email send, memory save, and high-risk tool actions are approval gated.
- High-risk approvals require phone or desktop confirmation before the external action can continue.
- Real display transport is explicit and operator controlled.
