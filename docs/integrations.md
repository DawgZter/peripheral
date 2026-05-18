# Integrations

The integration layer is intentionally contract-first. It describes what each sponsor or agent CLI can contribute to Agent Mode, which environment variables a live adapter would need, and which Peripheral surface should be rendered. The checked-in implementation is safe to run without secrets.

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

Live keys are not checked in. The descriptor layer records expected names such as `AGENTPHONE_API_KEY`, `STRIPE_SECRET_KEY`, `SUPERMEMORY_API_KEY`, `AGENTMAIL_API_KEY`, `BROWSER_USE_API_KEY`, `SPONGE_API_KEY`, and `GEMINI_API_KEY`.

## Agent CLI Coverage

| Agent CLI | Command | Session model | Peripheral surfaces |
| --- | --- | --- | --- |
| OpenClaw | `openclaw` | PTY | Progress card, approval card, terminal fallback. |
| Claude Code CLI | `claude` | tmux | Progress card, approval card, terminal fallback. |
| Pi | `pi` | adapter | Progress card, approval card, terminal fallback. |
| OpenCode | `opencode` | PTY | Progress card, approval card, terminal fallback. |
| Gemini CLI | `gemini` | stdio | Progress card, approval card, terminal fallback. |
| Codex CLI | `codex` | tmux | Progress card, approval card, terminal fallback. |

Adapters normalize CLI output into `AgentEvent` objects. The glasses see a compact semantic surface first, with raw terminal fallback only when no richer state is available.

## Review Commands

```sh
npm --prefix peripheral-hud-runtime run build
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations summary --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations sponsors --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations agent-clis --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations connected-state --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations widgets --json
```

The `widgets` command renders the sponsor and CLI matrices into `peripheral-hud-runtime/out/frames/integrations/`. Use `demo integrations --mock` for a frame-by-frame Agent Mode walkthrough.

## Safety Boundary

- Sponsors and agents emit semantic events, not raw BLE.
- Phone-owned mode policy decides whether a card is tiny, glance, fullscreen, pinned, delayed, or blocked.
- Payment, browser-submit, email-send, memory-save, and high-risk tool actions are approval-gated.
- The mock connected state is intentionally realistic for review while still avoiding live glasses tests.
