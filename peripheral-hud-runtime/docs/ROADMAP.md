# Roadmap

The v0 runtime proves the feeling first: agents can own a visual HUD surface using semantic widget objects and deterministic rendering. The Agent HUD Runtime is the scrappy Mac-connected predecessor to the future Peripheral Broker/MCP architecture: it owns local display state, simple agent status, Hermes launch/watch behavior, a Hermes CLI terminal view, and conservative pacing, while avoiding broker-scale policy and routing until the pitch experience is convincing.

## v0 Done Here

- Semantic widget JSON for the demo widget types.
- Deterministic monochrome renderer to `540x280` PNG plus 2 bpp sidecar.
- Mock/dry-run driver with JSONL logs.
- Existing full-panel image path wrapped behind a conservative driver.
- Canned live-call, blackjack, conference, and agent-approval flows.
- Agent HUD Runtime with blank default, look-up reveal, typed or Mac-mic command source, Hermes semantic adapter, Hermes CLI terminal view, dynamic widget watcher, and `hudctl` direct controls.
- Mock latency measurement and real-hardware measurement gate.

## Next Exact Experiments

1. With user permission, run one static real push and one short paced live-call demo.
2. Capture Mac helper timestamps for setup, readiness wait, each image write, and each ACK.
3. Compare response-gated writes against a carefully paced no-response run for simple flat frames.
4. Render a constrained `304x179` version of the same widgets and test the smaller image route if full-panel swaps feel slow.
5. Decide whether bitmap swaps are good enough for subtitle-style HUD updates at 700 ms to 2 s cadence.

## Native UI Backend Plan

If full-frame bitmap latency is too high, keep the same semantic widget schema and add a second renderer:

```text
semantic widget JSON
  -> native resource renderer
  -> create/update/delete labels, text boxes, image resources
  -> fallback to bitmap renderer when native resource confidence is low
```

Native backend validation should happen in dry-run/capture comparison first. Do not live-send unvalidated native resource commands without explicit operator approval.

## Runtime To Broker And MCP Path

When the runtime is convincing, graduate it into a broker that exposes stable semantic tools:

- `show_card`
- `ask_user`
- `show_table`
- `launch_widget`
- `update_widget`
- `clear`

The current runtime already enforces schema validation, deterministic rendering, pacing, and logs. The broker should add ownership, focus stack, event queue, durable approval state, permissions, and multiple real agent adapters. Agents still never generate transport packets.

## Phone Relay

The glasses have no network module, so the long-term runtime should support both Mac and phone relays:

- Mac relay for development and demos.
- Phone relay for everyday use.
- Same widget protocol above both relays.
- Capability discovery so agents know whether bitmap, native text, touch, audio, or approvals are currently available.

## Deferred Until After v0

- Full broker state machine.
- Production MCP server.
- Real AoE/Codex adapters and a richer Hermes adapter that can graduate from line-based CLI mirroring to a proper PTY/TUI bridge.
- Robust approval safety policy.
- Touch/head/audio discovery.
- Persistence/database.
- Multi-agent session orchestration.
- Native command backend.
