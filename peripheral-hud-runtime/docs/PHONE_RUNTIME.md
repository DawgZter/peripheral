# Phone Surface Runtime

Peripheral treats the phone app as the paired runtime for the glasses. Agent CLIs and sponsor adapters can request semantic surfaces, but the phone owns BLE, rendering, display leases, input capture, and the final decision about what appears.

## Mode Model

| Mode | Main owner | Agent access |
| --- | --- | --- |
| `current_stage` | Normal app/glasses experience | Quiet status icon or badge |
| `ambient_agent_hud` | Normal app plus tiny agent awareness | Glance-only interruptions |
| `agent_mode` | Glass Broker | Cards, widgets, approval surfaces, terminal fallback |
| `pairing` | Phone app | Blocked except diagnostics |
| `debug` | Developer tools | Blocked unless explicit |
| `system` | Phone/system safety | Blocked |

## Lease Rules

The surface runtime keeps exactly one active lease. A request can take over when:

- the active lease is interruptible
- the requested priority is at least as high as the active priority
- urgent system surfaces can preempt normal work
- debug/system modes block agent ownership unless explicitly released

This prevents Codex, Claude Code, AgentPhone, Stripe, Browser Use, and the normal app from fighting over the same monochrome display.

## Input Routing

The runtime routes wearer input in this order:

1. focused card
2. focused widget
3. explicitly named agent
4. mode manager intent
5. default broker brain

If a Stripe approval card is focused and the wearer says `approve`, that input goes back to the approval event. If there is no focused card and the wearer says `hey codex`, the broker routes to the Codex CLI adapter.

## Approval Policy

The phone runtime evaluates approval decisions before an external action can continue. Low-risk actions can proceed from voice or tap. Medium-risk actions require voice plus tap, phone, or desktop confirmation. High-risk actions require phone or desktop confirmation.

The rule only advances `approve`. `deny`, `details`, and `dismiss` remain safe card actions because they do not continue the external operation.

## Review Commands

```sh
npm run peripheralctl -- integrations phone-runtime --json
npm run peripheralctl -- integrations broker-timeline --json
npm run peripheralctl -- integrations mcp-manifest --json
npm run peripheralctl -- phone-runtime snapshot --json
npm run peripheralctl -- agent-bridge route --agent codex_cli --line "Codex needs approval to run npm test" --json
npm run peripheralctl -- agent-bridge runtime-plan --agent codex_cli --session-id codex-check --json
npm run peripheralctl -- phone-runtime lease --agent codex_cli --line "Codex needs approval to run npm test" --json
npm run peripheralctl -- phone-runtime route --line "hey codex show status" --json
npm run peripheralctl -- phone-runtime agent-mode-lease --line "User looked up into Agent Mode" --json
npm run peripheralctl -- phone-runtime approval-policy --json
npm run peripheralctl -- phone-runtime evaluate-decision --risk high --confirmation voice --choice approve --json
npm run peripheralctl -- phone-runtime evaluate-decision --risk high --confirmation phone --choice approve --json
```

These commands expose the same phone-owned routing path used by runtime and glasses flows. The runtime plan records launch commands, stdout/stderr line routing, JSONL audit posture, semantic surface conversion, and approve/deny return commands for each supported CLI.
