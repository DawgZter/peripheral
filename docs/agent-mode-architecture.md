# Agent Mode Architecture

Peripheral is designed as a paired smart-glasses runtime where the phone app owns the physical surface and the Mac/dev box owns agent sessions, sponsor adapters, and broker policy. Agents never write BLE packets or pixels directly. They request semantic UI through a broker layer, and the phone decides whether that UI can be rendered.

## System Roles

| Layer | Responsibility |
| --- | --- |
| Glasses | Display and input peripheral. Shows rendered frames and emits wearer input when available. |
| Phone app | Owns BLE, renderer state, mode switching, input capture, display leases, and final safety decisions. |
| Mac/dev box | Runs agent CLIs, sponsor adapters, broker policy, MCP-style tools, and audit logs. |
| Agents | Emit semantic requests: cards, approvals, tables, checklists, widgets, and bounded terminal fallback. |

## Mode Model

| Mode | Glasses behavior | Agent access |
| --- | --- | --- |
| `current_stage` | Normal app surface, minimal status, optional tiny warning icon. | Passive alerts only. |
| `ambient_agent_hud` | Tiny status HUD for running or waiting agents. | Low-risk badges and status. |
| `agent_mode` | Full agent cockpit with focused cards, approvals, widgets, and summaries. | Broker-mediated primary surface access. |
| `pairing` | Scan, connect, reconnect, and diagnostics flow. | Blocked except setup status. |
| `debug` | Protocol, render, BLE, and frame diagnostics. | Blocked unless explicitly enabled. |
| `system` | Emergency or system-owned surface. | Blocked. |

The runtime types live in `peripheral-hud-runtime/packages/peripheral-protocol/src/index.ts` and expose `AppMode`, `SurfaceLease`, `SurfaceCommand`, `InputEvent`, `AgentEvent`, and `UserDecision`.

## Surface Lease Rule

Only one owner can control the main glasses surface at a time. A lease records owner, priority, surface kind, mode, interruptibility, reason, source, and optional TTL. This prevents an agent terminal, a payment approval, a meeting brief, and the current app from fighting for the same pixels.

```json
{
  "id": "lease-agent-mode-main",
  "owner": "broker",
  "priority": "high",
  "surface": "fullscreen",
  "mode": "agent_mode",
  "interruptible": true,
  "reason": "User entered Agent Mode from the phone app."
}
```

## Broker Flow

1. Agent CLI or sponsor adapter emits an `AgentEvent`.
2. Broker policy decides whether it is ambient, glance, fullscreen, pinned, delayed, or denied.
3. Broker creates a `SurfaceCommand` with a lease and semantic widget.
4. Phone app validates mode, focus, risk, and confirmation policy.
5. Renderer turns the widget into a deterministic monochrome frame.
6. Display transport pushes only after explicit runtime gates allow it.

## Input Routing

The phone normalizes voice, taps, long press, head pose, look-up/look-down, app buttons, and dismiss into `InputEvent` objects. Routing order:

1. Focused card or widget wins.
2. Explicit agent name wins.
3. App mode intent wins.
4. Default broker brain handles the rest.

Approval responses must match the focused event and session. Low risk can use voice, medium risk should use voice plus tap or phone confirmation, and high risk requires phone or desktop confirmation.

The phone runtime is inspectable from the CLI:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime snapshot --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime lease --agent codex_cli --line "Codex needs approval to run npm test" --json
npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime route --line "hey codex show status" --json
```

## Connected State

`peripheralctl integrations connected-state --json` returns a glasses runtime object:

- glasses use the `phone_gateway` transport path, with telemetry details carried through the runtime profile
- phone owns BLE and rendering
- broker exposes a local MCP-style policy layer
- sponsor and agent CLI widgets are queued as surface commands
- display writes route through the phone-owned gateway and explicit runtime gates

That gives operators and reviewers a concrete glasses-first runtime surface through source and CLI before operator-driven glasses access.
