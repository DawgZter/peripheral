# Reviewer Map

This repo is built to make the Agent Mode architecture inspectable from source, fixtures, and hardware-gated CLI commands.

## Fastest Review Path

1. Read `docs/agent-mode-architecture.md`.
2. Read `docs/integrations.md`.
3. Run the structured commands below.

```sh
npm --prefix peripheral-hud-runtime ci
npm run check
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations live-adapters --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations support --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations broker-timeline --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime snapshot --json
```

## What The Repo Demonstrates

| Area | Where to inspect |
| --- | --- |
| Phone-owned surface runtime | `peripheral-hud-runtime/packages/peripheral-phone-runtime/src/index.ts` |
| Agent Mode protocol | `peripheral-hud-runtime/packages/peripheral-protocol/src/index.ts` |
| Sponsor and agent CLI registry | `peripheral-hud-runtime/packages/peripheral-integrations/src/index.ts` |
| CLI transcript normalization | `peripheral-hud-runtime/packages/peripheral-agent-bridge/src/index.ts` |
| Connected Agent Mode fixtures | `peripheral-hud-runtime/fixtures/agent_mode_connected_walkthrough.json` |
| Smoke coverage | `peripheral-hud-runtime/tests/renderer-smoke.test.ts` |

## Sponsor Coverage

The integration registry covers AgentPhone, Stripe, Supermemory, AgentMail, Browser Use, Sponge, and Gemini. Each entry records docs, credential names, credential-bound operations, agent events, risk levels, and the HUD surface each event should become.

The important design choice is that sponsor adapters emit semantic events. The phone runtime and broker decide whether those events become a tiny HUD, glance card, fullscreen approval, pinned status, delayed event, or blocked request.

## Agent CLI Coverage

The agent bridge covers OpenClaw, Claude Code CLI, Pi, OpenCode, Gemini CLI, and Codex CLI. The bridge normalizes bounded transcript lines into:

- `AgentEvent` objects
- approval cards
- progress cards
- completion cards
- error cards
- terminal fallback widgets

That makes CLI sessions readable on glasses without letting terminals own the display transport.

## Safety Boundary

- Agents request semantic UI; they do not write transport bytes.
- The phone owns BLE, renderer state, input capture, and display leases.
- The broker owns agent session routing and audit-friendly event normalization.
- Payment, browser submit, email send, memory save, and high-risk tool actions are approval gated.
- Runtime commands exercise broker routes; the explicit real-display path remains operator controlled.

## Command Proof Points

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations live-adapters --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations support --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations mcp-manifest --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations connected-state --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge launch-specs --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge event --agent codex_cli --line "Codex needs approval to run npm test" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime lease --agent codex_cli --line "Codex needs approval to run npm test" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-workflows dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime adapters --json
```

These commands are hardware-gated and public-source safe.
