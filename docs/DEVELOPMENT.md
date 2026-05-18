# Development

This repo is split into a browser-side display viewer, a TypeScript HUD runtime, and a small macOS display helper.

## Requirements

- Node.js 20 or newer for the HUD runtime.
- npm for installing the locked TypeScript dependencies.
- macOS with Swift only when building the CoreBluetooth helper.

## Install

```sh
npm --prefix peripheral-hud-runtime ci
```

## Checks

```sh
npm run check
```

That command runs the public-source guard, browser JavaScript syntax checks, compiles the HUD runtime, and runs renderer/runtime smoke tests.

For glasses runtime inspection and adapter coverage:

```sh
npm --prefix peripheral-hud-runtime run build
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations summary --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations connected-state --json
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations phone-runtime --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge dossier --json
npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge widget --agent codex_cli --line "Codex needs approval to run npm test"
npm --prefix peripheral-hud-runtime run peripheralctl -- hud --real --mic mac --hermes-cli --real-hermes
```

Those commands exercise sponsor descriptors, agent CLI descriptors, connected-glasses state, phone runtime policy, normalized CLI events, and rendered Agent Mode widgets with hardware writes gated behind explicit operator commands.

## Optional macOS Helper Build

```sh
npm run pusher:build
```

The helper build is separate from the default check path because it depends on the local macOS Swift toolchain. Live display use still requires explicit operator intent through the runtime's real-display flags.
