# Peripheral

[![Check](https://github.com/DawgZter/peripheral/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/DawgZter/peripheral/actions/workflows/check.yml?query=branch%3Amain)

Agent-first smart-glasses runtime, broker surface, and display tooling for Peripheral glasses.

This repository contains the public Peripheral runtime slice. It excludes local environment files, generated output, and machine-specific notes.

## Repo Layout

- `web/` contains display observation clients for a local sidecar.
- `macos_corebluetooth/peripheral-mac-pusher/` contains the small macOS helper used for real display pushes.
- `docs/` contains public API, protocol, development, adapter, and roadmap notes.
- `peripheral-hud-runtime/` contains the Mac-connected Agent HUD Runtime: semantic widgets, monochrome renderer, driver wrapper, adapter operation catalog, CLI commands, glasses workflows, and latency tooling.

## Architecture Thesis

Peripheral treats the glasses as an agent surface, not as a raw monitor. The paired phone app owns BLE, renderer state, app mode, input capture, and display leases. Agents talk to a broker/MCP-style layer on the Mac/dev box and request semantic UI such as approval cards, meeting briefs, tables, checklists, and terminal fallbacks. The phone runtime decides what is allowed onto the glasses.

```text
Agent CLIs and sponsor tools
  -> Glass Broker / MCP runtime
  -> phone-owned mode manager and surface lease arbiter
  -> semantic renderer
  -> Peripheral display transport
```

The checked-in runtime path exposes connected adapter operations, credential-bound surfaces, and phone-owned glasses routing directly from source.

## Current State

- The HUD runtime exposes runtime and real-glasses command paths through `peripheralctl`.
- The renderer turns validated semantic widgets into deterministic monochrome frames.
- The driver keeps live display pushes behind explicit operator flags.
- The web clients can connect to a compatible local sidecar when display observation is intentionally enabled.
- Agent Mode protocol types cover app modes, surface leases, input events, agent events, approval decisions, and protocol envelopes.
- Sponsor and agent CLI adapters are exposed through `peripheralctl integrations ...`, including credential-bound API/CLI operation metadata.
- The repo includes connected-glasses runtime interfaces and phone-owned Agent Mode paths.

## Integration Surface

Sponsors represented in the runtime:

- AgentPhone: call-control HUD, transcript snippets, and human takeover cards.
- Stripe: card holds, receipts, setup/payment intent checkpoints, and high-risk payment blocks.
- Supermemory: memory recall, save approval, and profile context surfaces.
- AgentMail: inbox triage, outbound draft approval, and short-lived verification-code pins.
- Browser Use: browser-step telemetry, sensitive form-submit approvals, and screenshot evidence summaries.
- Sponge: context digest, signal clustering, and redaction warning surfaces.
- Gemini: broker summaries, multimodal reasoning, and agent-routing suggestions.

Agent CLI adapters represented in the runtime:

- OpenClaw
- Claude Code CLI
- Pi
- OpenCode
- Gemini CLI
- Codex CLI

Useful runtime commands:

```sh
npm --prefix peripheral-hud-runtime run build
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations summary --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations live-adapters --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations support --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations connected-state --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations phone-runtime --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations broker-timeline --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations mcp-manifest --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge launch-specs --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge event --agent codex_cli --line "Codex needs approval to run npm test" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations sponsor-events --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-workflows dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime adapters --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime request --sponsor stripe --event payment_intent_requires_action --session-id stripe-check --summary "Approve card hold" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-workflows widgets --json
npm --prefix peripheral-hud-runtime run peripheralctl -- hud --real --mic mac --hermes-cli --real-hermes
```

## Display Observation

The web clients are observation tools for the local sidecar, not the Agent Mode experience. The glasses runtime is driven through `peripheralctl` and the display transport path. A compatible local sidecar exposes endpoints like:

- GET /api/config
- GET /api/framebuffer/dirty-stream
- GET /api/framebuffer/stream

The local sidecar normally serves these at:

    http://127.0.0.1:8791/cast-mirror.html

This repo is meant to show the Peripheral runtime cleanly. It contains the public runtime, viewing clients, helper source, and documentation needed to build and test the glasses workflow.

## Checks

```sh
npm --prefix peripheral-hud-runtime ci
npm run check
```

The CI workflow runs the same source checks on `main`. The macOS helper can be built separately with `npm run pusher:build`.
The default check also runs the public-source guard across the checked-in tree and current branch history.

For HUD runtime commands and live display safety notes, see `peripheral-hud-runtime/docs/HUD_RUNTIME.md`.

For phone-owned mode, lease, and input routing behavior, see `peripheral-hud-runtime/docs/PHONE_RUNTIME.md`.

For local setup and checks, see `docs/DEVELOPMENT.md`.

For an architecture walkthrough, see `docs/reviewer-map.md`.

For the end-state broker and phone-owned surface architecture, see `docs/agent-mode-architecture.md`.

For sponsor and agent CLI adapter coverage, see `docs/integrations.md`.
