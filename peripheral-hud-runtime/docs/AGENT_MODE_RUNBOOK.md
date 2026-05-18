# Connected Agent Mode Fixtures

This walkthrough is a connected Agent Mode source storyboard: the phone runtime owns Agent Mode, sponsor cards are defined as semantic surfaces, an agent CLI is running, and a payment-like action is held behind approval.

BLE connection attempts, display writes, calls, browser submissions, and payment APIs stay behind their runtime gates. The fixture lives at `fixtures/agent_mode_connected_walkthrough.json`.

## Storyboard

1. Connected state: `fixtures/ui/agent_mode_connected_status.json` shows the phone runtime, broker lease, and renderer path.
2. Sponsor cards: `fixtures/ui/agent_mode_sponsor_cards.json` shows AgentPhone, Browser Use, Supermemory, and Stripe as semantic HUD surfaces.
3. CLI status: `fixtures/ui/agent_mode_cli_status.json` shows Codex CLI as terminal fallback while the broker keeps policy ownership.
4. Approval gate: `fixtures/ui/agent_mode_approval_gate.json` shows the focused Stripe approval card that requires voice or tap.

## Render The Cards

```sh
cd peripheral-hud-runtime
npm run peripheralctl -- render-json fixtures/ui/agent_mode_connected_status.json --out out/frames/agent-mode-connected-status.png
npm run peripheralctl -- render-json fixtures/ui/agent_mode_sponsor_cards.json --out out/frames/agent-mode-sponsor-cards.png
npm run peripheralctl -- render-json fixtures/ui/agent_mode_cli_status.json --out out/frames/agent-mode-cli-status.png
npm run peripheralctl -- render-json fixtures/ui/agent_mode_approval_gate.json --out out/frames/agent-mode-approval-gate.png
```

## Broker Views

Use the integration broker commands to show the same story as structured state:

```sh
npm run peripheralctl -- integrations connected-state --json
npm run peripheralctl -- integrations broker-timeline --json
npm run peripheralctl -- integrations widgets --json
```

The expected narration is:

- AgentPhone owns the call surface.
- Browser Use contributes website step telemetry.
- Supermemory contributes short recall cards.
- Stripe requests a focused approval before any payment-like action.
- Codex CLI is visible through bounded terminal fallback, but the surface lease and approval policy remain broker-owned.

## Safety

Keep runtime commands as the default unless the operator explicitly asks for a real glasses action. The connected state demonstrates the phone-owned glasses flow and broker routing from source.
