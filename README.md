# Peripheral

[![Check](https://github.com/DawgZter/peripheral/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/DawgZter/peripheral/actions/workflows/check.yml?query=branch%3Amain)

Agent-first smart-glasses runtime, broker surface, and display tooling for Peripheral glasses.

This repository contains the public Peripheral runtime slice. It excludes local environment files, generated output, and machine-specific notes.

## Repo Layout

- `web/` contains display observation clients for a local sidecar.
- `macos_corebluetooth/peripheral-mac-pusher/` contains the small macOS helper used for real display pushes.
- `docs/` contains public API, protocol, development, demo, and roadmap notes.
- `peripheral-hud-runtime/` contains the Mac-connected Agent HUD Runtime: semantic widgets, monochrome renderer, driver wrapper, CLI commands, mock demos, and latency tooling.

## Architecture Thesis

Peripheral treats the glasses as an agent surface, not as a raw monitor. The paired phone app owns BLE, renderer state, app mode, input capture, and display leases. Agents talk to a broker/MCP-style layer on the Mac/dev box and request semantic UI such as approval cards, meeting briefs, tables, checklists, and terminal fallbacks. The phone runtime decides what is allowed onto the glasses.

```text
Agent CLIs and sponsor tools
  -> Glass Broker / MCP contracts
  -> phone-owned mode manager and surface lease arbiter
  -> semantic renderer
  -> Peripheral display transport
```

The checked-in demo path uses a mock connected-glasses state, so reviewers can inspect the phone/broker model without live BLE or hardware.

## Current State

- The HUD runtime can run without hardware through `peripheralctl hud --mock-display --text`.
- The renderer turns validated semantic widgets into deterministic monochrome frames.
- The driver supports mock runs by default and requires explicit opt-in for live display pushes.
- The web clients can connect to a compatible local sidecar when display observation is intentionally enabled.
- Agent Mode protocol types cover app modes, surface leases, input events, agent events, approval decisions, and protocol envelopes.
- Sponsor and agent CLI integration descriptors are exposed through `peripheralctl integrations ...`.
- The repo includes mock connected-glasses surfaces that make the phone appear paired and in control while avoiding live display writes.

## Hackathon Integration Surface

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

Useful review commands:

```sh
npm --prefix peripheral-hud-runtime run build
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations summary --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations connected-state --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- demo integrations --mock
```

## Local Usage

Run this with a compatible local sidecar server. The page expects API endpoints like:

- GET /api/config
- GET /api/framebuffer/dirty-stream
- GET /api/framebuffer/stream

The local sidecar normally serves these at:

    http://127.0.0.1:8791/cast-mirror.html

This repo is meant to show the Peripheral runtime cleanly. It contains the public runtime, viewing clients, helper source, and documentation needed to build and test the demo.

## Checks

```sh
npm --prefix peripheral-hud-runtime ci
npm run check
```

The CI workflow runs the same source checks on `main`. The macOS helper can be built separately with `npm run pusher:build`.
The default check also runs the public-source guard across the checked-in tree and current branch history.

For HUD runtime commands and live display safety notes, see `peripheral-hud-runtime/docs/HUD_RUNTIME.md`.

For local setup and checks, see `docs/DEVELOPMENT.md`.

For the end-state broker and phone-owned surface architecture, see `docs/agent-mode-architecture.md`.

For sponsor and agent CLI adapter coverage, see `docs/integrations.md`.
