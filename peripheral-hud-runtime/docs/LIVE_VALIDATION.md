# Live Validation

This page is the safety gate for validating the Peripheral HUD runtime against the live display tools.

## Current Rule

Mock render/driver validation can run anytime. Read-only sidecar diagnostics are safe to run because they only query local HTTP status endpoints:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- diagnostics --mock --json
npm --prefix peripheral-hud-runtime run peripheralctl -- live-check --mock --json
```

That command reports:

- helper build status
- local sidecar reachability
- paired and connected peripheral counts
- display geometry
- whether the Mac bridge is running
- whether read-only capture is ready

`live-check` can also run the same gate plus an optional read-only capture. This touches the live readback path but does not send HUD images or captions:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- live-check --mock --capture --json
```

If the bridge is not ready, capture is skipped with `capture.skipped: true` and the command records why. A pair/connect attempt changes Bluetooth state and is gated separately:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- live-check --attempt-connect --real-hardware-ok --json
```

Use `--attempt-connect` only after explicit operator permission.

## Readiness Gate

The runtime is ready for read-only display capture only when:

```json
{
  "sidecar": {
    "reachable": true,
    "readyForReadOnlyCapture": true,
    "glasses": {
      "connectedCount": 1
    },
    "displaySurface": {
      "displayTransport": "mac",
      "transportReady": true,
      "geometryReady": true,
      "macBridge": { "running": true }
    }
  }
}
```

If `readyForReadOnlyCapture` is false, do not treat live validation as complete. Fix the local bridge/pairing state first, then rerun diagnostics. A running Mac bridge without a connected peripheral is not enough; recent failures showed capture can still exit before ready in that state.

## Read-Only Capture

Once diagnostics says read-only capture is ready, capture a small ROI without changing the display:

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- live-check --mock --capture --json
```

For lower-level evidence, the standalone helper can capture the same kind of ROI:

```sh
python3 analysis/peripheral_live_validation.py \
  capture-roi-3 \
  --cycles 1 \
  --live \
  --json-out build/hud_runtime_validation/read_only_capture_roi3.json
```

Expected evidence:

- schema is `peripheral-live-validation-result-v1`
- scenario is `capture-roi-3`
- `live` is true
- at least one result has `ok: true`
- summary includes raw byte count, page range, and high-nibble pixel statistics

For `peripheralctl live-check --capture`, expected evidence is:

- `ok: true`
- `readyForReadOnlyCapture: true`
- `capture.attempted: true`
- `capture.ok: true`
- `capture.readOnly: true`
- `capture.displayChanging: false`
- `capture.rawBytes` greater than zero
- `capture.highNibbleNonZeroBytes` present

Lower-level helper scenarios that send captions or text ticks require a second opt-in:

```sh
python3 analysis/peripheral_live_validation.py text-delta-roi-11 --live --allow-display-change
```

Without `--allow-display-change`, `--live` text/tick scenarios print the plan and exit before touching the display.

## Display-Changing HUD Push

Only after explicit permission, run one static frame before a paced demo:

```sh
npm run pusher:build
npm --prefix peripheral-hud-runtime run peripheralctl -- push-json \
  peripheral-hud-runtime/fixtures/ui/generic_card.json \
  --real-hardware-ok \
  --json
```

Observe the result through:

```text
http://127.0.0.1:8791/real-mirror.html
```

Then run the HUD text loop with real display only after the static frame is visible:

```sh
{
  printf "look_up\n"
  sleep 0.2
  printf "Hermes test task\n"
  sleep 2
  printf "exit\n"
} | npm --prefix peripheral-hud-runtime run peripheralctl -- hud --real --text --json
```

## Latest Local Check

Latest safe read-only checks:

- `npm --prefix peripheral-hud-runtime run peripheralctl -- diagnostics --mock --json`
- `npm --prefix peripheral-hud-runtime run peripheralctl -- live-check --mock --capture --json`
- `npm --prefix peripheral-hud-runtime run peripheralctl -- live-check --mock --json`

Observed evidence from the latest read-only capture run:

- sidecar reachable: yes
- display transport: mac
- paired peripherals: 1
- connected peripherals: 1
- Mac bridge running: yes
- read-only capture ready: yes
- capture attempted: yes
- capture ok: yes
- capture page range: 184 plus 3 pages
- capture duration: 3082 ms
- capture raw bytes: 756
- high-nibble nonzero bytes: 100

A later status-only `live-check --mock --json` also reported `readyForReadOnlyCapture: true`, `captureRequested: false`, paired peripherals: 1, connected peripherals: 1, Mac bridge running: yes, and `displayChangingPushRequiresPermission: true`. This proves the safe read-only display gate is working. It does not prove live display-changing HUD pushes; those still require explicit operator permission.
