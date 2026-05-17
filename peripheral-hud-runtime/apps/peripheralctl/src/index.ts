#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { MAP_WIDGET_DISPLAY, PERIPHERAL_DISPLAY, WIDGET_TYPES, assertWidget, type GlassWidget } from "../../../packages/peripheral-protocol/src/index.js";
import { defaultFramePath, previewName, renderWidget, renderWidgetFile, renderWidgetToFile } from "../../../packages/peripheral-renderer/src/index.js";
import {
  appendJsonl,
  buildDisplayImageFrames,
  clearDisplay,
  defaultLogPath,
  pushArtifact,
  showImage,
  status,
  writeLatencyMarkdown,
  type DriverOptions,
} from "../../../packages/peripheral-driver/src/index.js";
import {
  clearHud,
  emitAgentStatus,
  hudStatus,
  listAgents,
  runTextAsrDemo,
  runHudRuntime,
  showHudCard,
  showHudJson,
  type HermesMode,
  type AsrProvider,
  type HudInputMode,
  type HudRuntimeOptions,
  type ScriptedTranscriptStep,
} from "../../../packages/peripheral-runtime/src/index.js";
import type { AgentStatus } from "../../../packages/peripheral-protocol/src/index.js";

type ParsedCli = {
  command: string;
  positionals: string[];
  options: Record<string, string | boolean>;
};

const VALUE_FLAGS = new Set([
  "out",
  "log",
  "title",
  "body",
  "cadence-ms",
  "mic",
  "image-prefix-hex",
  "repo-root",
  "project-root",
  "page-count",
  "page-start",
  "sidecar-url",
  "script",
  "asr-text",
  "step-delay-ms",
  "asr-provider",
  "stt-cmd",
  "asr-locale",
  "asr-silence-ms",
  "asr-duration-seconds",
  "asr-http-port",
  "openai-asr-model",
  "openai-asr-protocol",
  "openai-env-file",
  "openai-asr-ffmpeg-input",
  "timeout-seconds",
]);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const hudctlShim = argv[0] === "hudctl" || argv[0] === "--hudctl";
  if (basename(process.argv[1] || "").includes("hudctl") || hudctlShim) {
    await mainHudctl(hudctlShim ? argv.slice(1) : argv);
    return;
  }
  const cli = parseCli(argv);
  if (!cli.command || cli.options.help || cli.command === "help") {
    printHelp();
    return;
  }

  const projectRoot = resolve(String(cli.options["project-root"] || findProjectRoot()));
  const repoRoot = resolve(String(cli.options["repo-root"] || join(projectRoot, "..")));
  const logPath = resolve(String(cli.options.log || defaultLogPath(projectRoot, cli.command.replace(/[^a-z0-9_-]/gi, "_"))));
  const driverOptions: DriverOptions = {
    projectRoot,
    repoRoot,
    mock: Boolean(cli.options.mock),
    dryRun: Boolean(cli.options["dry-run"]),
    verbose: Boolean(cli.options.verbose),
    json: Boolean(cli.options.json),
    logPath,
    imagePrefixHex: String(cli.options["image-prefix-hex"] || PERIPHERAL_DISPLAY.imagePrefixHex),
    timeoutSeconds: Number(cli.options["timeout-seconds"] || 120),
  };
  const realHardwareOk = Boolean(cli.options["real-hardware-ok"]);
  assertRealHardwareGate(cli.command, driverOptions, realHardwareOk);

  let result: unknown;
  switch (cli.command) {
    case "render-json":
      result = await commandRenderJson(cli, projectRoot);
      break;
    case "push-json":
      result = await commandPushJson(cli, projectRoot, driverOptions);
      break;
    case "show-image":
      result = await commandShowImage(cli, driverOptions);
      break;
    case "clear":
      result = await clearDisplay(driverOptions);
      break;
    case "status":
      result = await status(driverOptions);
      break;
    case "measure-latency":
      result = await commandMeasureLatency(projectRoot, driverOptions, realHardwareOk);
      break;
    case "demo":
      result = await commandDemo(cli, projectRoot, driverOptions);
      break;
    case "diagnostics":
      result = await commandDiagnostics(projectRoot, repoRoot, driverOptions, String(cli.options["sidecar-url"] || "http://127.0.0.1:8791"));
      break;
    case "live-check":
      result = await commandLiveCheck(cli, projectRoot, driverOptions, String(cli.options["sidecar-url"] || "http://127.0.0.1:8791"));
      break;
    case "hud":
      result = await commandHud(cli, projectRoot, repoRoot, logPath);
      break;
    case "asr-demo":
      result = await commandAsrDemo(cli, projectRoot, repoRoot, logPath);
      break;
    case "agents":
      result = await commandAgents(cli, projectRoot, repoRoot, logPath);
      break;
    case "render-card":
      result = await commandRenderCard(cli, projectRoot);
      break;
    case "capabilities":
      result = capabilities();
      break;
    default:
      throw new Error(`Unknown command: ${cli.command}. Run peripheralctl --help.`);
  }

  printResult(result, Boolean(cli.options.json));
}

async function mainHudctl(argv: string[] = process.argv.slice(2)): Promise<void> {
  const cli = parseCli(argv);
  if (!cli.command || cli.options.help || cli.command === "help") {
    printHudctlHelp();
    return;
  }
  const projectRoot = resolve(String(cli.options["project-root"] || findProjectRoot()));
  const repoRoot = resolve(String(cli.options["repo-root"] || join(projectRoot, "..")));
  const logPath = resolve(String(cli.options.log || defaultLogPath(projectRoot, "hudctl")));
  const options = runtimeOptions(cli, projectRoot, repoRoot, logPath);
  let result: unknown;
  switch (cli.command) {
    case "show-json": {
      const input = cli.positionals[0];
      if (!input) throw new Error("hudctl show-json requires <file>");
      result = await showHudJson(resolve(input), options);
      break;
    }
    case "show-card":
      result = await showHudCard(String(cli.options.title || "HUD Card"), String(cli.options.body || ""), options);
      break;
    case "clear":
      result = await clearHud(options);
      break;
    case "status":
      result = await hudStatus(options);
      break;
    case "emit-agent-status": {
      const agent = cli.positionals[0];
      const statusValue = cli.positionals[1];
      if (!agent || !statusValue) throw new Error("hudctl emit-agent-status requires <agent> <status>");
      result = await emitAgentStatus(agent, statusValue as AgentStatus, options);
      break;
    }
    default:
      throw new Error(`Unknown hudctl command: ${cli.command}. Run hudctl --help.`);
  }
  printResult(result, Boolean(cli.options.json));
}

async function commandHud(cli: ParsedCli, projectRoot: string, repoRoot: string, logPath: string): Promise<unknown> {
  const options = runtimeOptions(cli, projectRoot, repoRoot, logPath);
  return runHudRuntime(options);
}

async function commandAsrDemo(cli: ParsedCli, projectRoot: string, repoRoot: string, logPath: string): Promise<unknown> {
  const options: HudRuntimeOptions = { ...runtimeOptions(cli, projectRoot, repoRoot, logPath), inputMode: "mock_asr" };
  const script = loadAsrDemoScript(cli, projectRoot);
  const baseUrl = String(cli.options["sidecar-url"] || "http://127.0.0.1:8791").replace(/\/+$/, "");
  const stepDelayMs = Math.max(0, Number(cli.options["step-delay-ms"] || options.cadenceMs || 1400));
  if (!Number.isFinite(stepDelayMs)) {
    throw new Error("--step-delay-ms must be a number.");
  }
  const proofBefore = cli.options["framebuffer-check"] ? await readFramebufferProof(baseUrl, cli, "before") : null;
  const result = await runTextAsrDemo(options, {
    steps: script.steps,
    stepDelayMs,
    startBlank: !cli.options["no-start-blank"],
  });
  const proofAfter = cli.options["framebuffer-check"] ? await readFramebufferProof(baseUrl, cli, "after") : null;
  const framebufferProof = proofBefore || proofAfter ? {
    requested: true,
    sidecarUrl: baseUrl,
    before: proofBefore,
    after: proofAfter,
    changed: Boolean(proofBefore?.captureSha256 && proofAfter?.captureSha256 && proofBefore.captureSha256 !== proofAfter.captureSha256),
  } : { requested: false };
  await appendJsonl(logPath, { event: "asr-demo", script, result, framebufferProof });
  return { ...result, script, framebufferProof };
}

async function commandAgents(cli: ParsedCli, projectRoot: string, repoRoot: string, logPath: string): Promise<unknown> {
  const options = runtimeOptions(cli, projectRoot, repoRoot, logPath);
  return listAgents(options);
}

function runtimeOptions(cli: ParsedCli, projectRoot: string, repoRoot: string, logPath: string): HudRuntimeOptions {
  const realDisplay = Boolean(cli.options.real);
  const inputMode: HudInputMode = cli.options.mic === "mac" || cli.options["mac-mic"] ? "mac_mic" : "text";
  const hermesMode: HermesMode = cli.options["real-hermes"] ? "real" : cli.options["mock-hermes"] ? "mock" : "auto";
  const asrProvider = normalizeAsrProvider(cli.options["asr-provider"]);
  return {
    projectRoot,
    repoRoot,
    displayMode: realDisplay ? "real" : "mock",
    inputMode,
    hermesMode,
    startHermesCli: Boolean(cli.options["hermes-cli"]),
    sttCommand: typeof cli.options["stt-cmd"] === "string" ? cli.options["stt-cmd"] : undefined,
    asrProvider,
    asrLocale: typeof cli.options["asr-locale"] === "string" ? cli.options["asr-locale"] : undefined,
    asrSilenceMs: flagNumber(cli.options["asr-silence-ms"], "--asr-silence-ms", 300),
    asrDurationSeconds: flagNumber(cli.options["asr-duration-seconds"], "--asr-duration-seconds", 0.1),
    asrPartials: Boolean(cli.options["asr-partials"]),
    asrHttpPort: flagNumber(cli.options["asr-http-port"], "--asr-http-port", 0),
    openaiAsrModel: typeof cli.options["openai-asr-model"] === "string" ? cli.options["openai-asr-model"] : undefined,
    openaiAsrProtocol: typeof cli.options["openai-asr-protocol"] === "string" ? cli.options["openai-asr-protocol"] : undefined,
    openaiEnvFile: typeof cli.options["openai-env-file"] === "string" ? cli.options["openai-env-file"] : undefined,
    openaiAsrFfmpegInput: typeof cli.options["openai-asr-ffmpeg-input"] === "string" ? cli.options["openai-asr-ffmpeg-input"] : undefined,
    logPath,
    json: Boolean(cli.options.json),
    cadenceMs: Math.max(700, Number(cli.options["cadence-ms"] || 1400)),
  };
}

function normalizeAsrProvider(value: string | boolean | undefined): AsrProvider {
  const clean = typeof value === "string" ? value.trim() : process.env.PERIPHERAL_HUD_ASR_PROVIDER || "auto";
  if (clean === "openai" || clean === "openai-realtime") return "openai-realtime";
  if (clean === "macos" || clean === "macos-speech" || clean === "native") return "macos-speech";
  return "auto";
}

async function commandRenderJson(cli: ParsedCli, projectRoot: string): Promise<unknown> {
  const input = cli.positionals[0];
  if (!input) throw new Error("render-json requires <ui.json>");
  const out = resolve(String(cli.options.out || join(projectRoot, "out", "frames", previewName(input))));
  const artifact = renderWidgetFile(resolve(input), out, { assetRoot: join(projectRoot, "fixtures", "images") });
  return { ok: true, artifact };
}

async function commandPushJson(cli: ParsedCli, projectRoot: string, driverOptions: DriverOptions): Promise<unknown> {
  const input = cli.positionals[0];
  if (!input) throw new Error("push-json requires <ui.json>");
  const widget = assertWidget(JSON.parse(readFileSync(resolve(input), "utf8")) as unknown);
  const out = resolve(String(cli.options.out || defaultFramePath(join(projectRoot, "out", "frames"), widget)));
  const artifact = renderWidgetToFile(widget, out, { assetRoot: join(projectRoot, "fixtures", "images") });
  const push = await pushArtifact(artifact, driverOptions);
  await appendJsonl(driverOptions.logPath || defaultLogPath(projectRoot), { event: "push-json", input: resolve(input), artifact, push });
  return { ok: true, artifact, push };
}

async function commandShowImage(cli: ParsedCli, driverOptions: DriverOptions): Promise<unknown> {
  const input = cli.positionals[0];
  if (!input) throw new Error("show-image requires <frame.png>");
  return showImage(resolve(input), driverOptions);
}

async function commandRenderCard(cli: ParsedCli, projectRoot: string): Promise<unknown> {
  const widget: GlassWidget = {
    id: "render-card",
    type: "generic_card",
    title: String(cli.options.title || "Agent Card"),
    body: String(cli.options.body || "No body supplied."),
    status: "READY",
    created_at: new Date().toISOString(),
  };
  const out = resolve(String(cli.options.out || join(projectRoot, "out", "frames", "render-card.png")));
  const artifact = renderWidgetToFile(widget, out, { assetRoot: join(projectRoot, "fixtures", "images") });
  return { ok: true, artifact };
}

async function commandDemo(cli: ParsedCli, projectRoot: string, driverOptions: DriverOptions): Promise<unknown> {
  const name = cli.positionals[0];
  if (!name) throw new Error("demo requires one of: live-call, blackjack, conference, agent");
  const cadenceMs = Math.max(250, Number(cli.options["cadence-ms"] || 1400));
  const flow = demoFlow(name);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const frameDir = join(projectRoot, "out", "frames", `demo-${name}-${stamp}`);
  const steps = [];
  for (const [index, widget] of flow.entries()) {
    const artifact = renderWidgetToFile(widget, join(frameDir, `${String(index + 1).padStart(2, "0")}-${widget.type}.png`), {
      assetRoot: join(projectRoot, "fixtures", "images"),
    });
    const push = await pushArtifact(artifact, driverOptions);
    const step = { index, widgetId: widget.id, widgetType: widget.type, artifact, push, intendedCadenceMs: cadenceMs };
    steps.push(step);
    await appendJsonl(driverOptions.logPath || defaultLogPath(projectRoot), { event: "demo.step", demo: name, ...step });
    if (index < flow.length - 1) {
      await delay(driverOptions.mock || driverOptions.dryRun ? Math.min(80, cadenceMs) : cadenceMs);
    }
  }
  return { ok: true, demo: name, frames: frameDir, logPath: driverOptions.logPath, steps: steps.length };
}

async function commandMeasureLatency(projectRoot: string, driverOptions: DriverOptions, realHardwareOk: boolean): Promise<unknown> {
  if (!driverOptions.mock && !driverOptions.dryRun && !realHardwareOk) {
    throw new Error("measure-latency without --mock requires --real-hardware-ok after explicit live-glasses permission.");
  }
  const cases = [
    { case: "generic_card", path: join(projectRoot, "fixtures", "ui", "generic_card.json"), route: "full-panel" },
    { case: "live_call_chunk", path: join(projectRoot, "fixtures", "ui", "live_call_connected.json"), route: "full-panel" },
    { case: "person_detail", path: join(projectRoot, "fixtures", "ui", "person_detail.json"), route: "full-panel" },
    { case: "flat_strategy", path: join(projectRoot, "fixtures", "ui", "strategy_card.json"), route: "full-panel" },
  ];
  const rows: Record<string, unknown>[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const item of cases) {
    const raw = JSON.parse(readFileSync(item.path, "utf8")) as unknown;
    const renderStart = performance.now();
    const artifact = renderWidgetToFile(raw, join(projectRoot, "out", "frames", "latency", stamp, item.case + ".png"), {
      assetRoot: join(projectRoot, "fixtures", "images"),
    });
    const renderMs = roundMs(performance.now() - renderStart);
    const encodeStart = performance.now();
    const built = buildDisplayImageFrames(Buffer.from(artifact.pixelsBase64, "base64"), {
      width: PERIPHERAL_DISPLAY.width,
      height: PERIPHERAL_DISPLAY.height,
      imagePrefixHex: PERIPHERAL_DISPLAY.imagePrefixHex,
    });
    const encodeMs = roundMs(performance.now() - encodeStart);
    const pushStart = performance.now();
    const push = driverOptions.mock || driverOptions.dryRun
      ? await mockLatencyPush(projectRoot, driverOptions, item.case, built)
      : await pushArtifact(artifact, driverOptions);
    const pushMs = roundMs(performance.now() - pushStart);
    rows.push({
      case: item.case,
      route: item.route,
      renderMs,
      encodeMs,
      pushMs,
      pushMode: driverOptions.mock || driverOptions.dryRun ? "mock" : "real",
      compressedBytes: built.compressed.length,
      payloadBytes: built.payload.length,
      frames: built.frames.length,
      rawBytes: Buffer.from(artifact.pixelsBase64, "base64").length,
      push,
    });
    if (!driverOptions.mock && !driverOptions.dryRun) await delay(1400);
  }
  const docsPath = join(projectRoot, "docs", "LATENCY.md");
  const maxEncode = Math.max(...rows.map((row) => Number(row.encodeMs)));
  const maxFrames = Math.max(...rows.map((row) => Number(row.frames)));
  const interpretation = [
    `Mock render plus encode is comfortably below one subtitle cadence on this Mac; max encode was ${maxEncode} ms and max full-panel fragment count was ${maxFrames}.`,
    "This does not prove live transport send or wearer-visible refresh. Real bridge testing needs explicit permission because the glasses are in live use.",
    "Default v0 cadence remains 1400 ms for live-call chunks, with 700 ms as an optimistic lower bound only after real bridge measurements look stable.",
  ].join(" ");
  await writeLatencyMarkdown(docsPath, rows, interpretation);
  return { ok: true, mock: Boolean(driverOptions.mock || driverOptions.dryRun), docsPath, rows, interpretation, logPath: driverOptions.logPath };
}

async function mockLatencyPush(projectRoot: string, driverOptions: DriverOptions, caseName: string, built: ReturnType<typeof buildDisplayImageFrames>): Promise<Record<string, unknown>> {
  await appendJsonl(driverOptions.logPath || defaultLogPath(projectRoot), {
    event: "latency.mock-push",
    case: caseName,
    frames: built.frames.length,
    compressedBytes: built.compressed.length,
  });
  return { ok: true, mock: true, frames: built.frames.length, compressedBytes: built.compressed.length };
}

async function commandDiagnostics(projectRoot: string, repoRoot: string, driverOptions: DriverOptions, sidecarUrl: string): Promise<unknown> {
  const helper = join(repoRoot, "macos_corebluetooth", "peripheral-mac-pusher", ".build", "manual", "peripheral-mac-pusher");
  const fixtures = readdirSync(join(projectRoot, "fixtures", "ui")).filter((file) => file.endsWith(".json"));
  const sidecar = await readSidecarDiagnostics(sidecarUrl);
  const result = {
    ok: true,
    projectRoot,
    repoRoot,
    helper,
    helperExists: existsSync(helper),
    mock: Boolean(driverOptions.mock),
    display: PERIPHERAL_DISPLAY,
    mapWidgetDisplay: MAP_WIDGET_DISPLAY,
    widgetTypes: WIDGET_TYPES,
    fixtures,
    sidecar,
    logPath: driverOptions.logPath,
  };
  await appendJsonl(driverOptions.logPath || defaultLogPath(projectRoot), { event: "diagnostics", ...result });
  return result;
}

async function commandLiveCheck(cli: ParsedCli, projectRoot: string, driverOptions: DriverOptions, sidecarUrl: string): Promise<unknown> {
  const logPath = driverOptions.logPath || defaultLogPath(projectRoot, "live-check");
  const baseUrl = sidecarUrl.replace(/\/+$/, "");
  const started = performance.now();
  if (cli.options["attempt-connect"] && !cli.options["real-hardware-ok"]) {
    throw new Error("live-check --attempt-connect requires --real-hardware-ok after explicit live-device permission.");
  }
  const before = await readSidecarDiagnostics(baseUrl);
  let pairConnect: Record<string, unknown> | undefined;
  let after = before;
  if (cli.options["attempt-connect"] && !diagnosticsReady(before)) {
    const response = await fetchSidecarJson(baseUrl + "/api/glasses/pair-connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeoutSeconds: Number(cli.options["timeout-seconds"] || 45) }),
    });
    pairConnect = summarizePairConnect(response);
    after = await readSidecarDiagnostics(baseUrl);
  }
  let capture: Record<string, unknown> = {
    attempted: false,
    skipped: true,
    reason: "Pass --capture and wait for readyForReadOnlyCapture before capture.",
  };
  if (cli.options.capture) {
    after = await readSidecarDiagnostics(baseUrl);
    if (diagnosticsReady(after)) {
      capture = await captureReadOnlyFrame(baseUrl, cli);
    } else {
      capture = {
        attempted: false,
        skipped: true,
        reason: "Read-only capture skipped because sidecar is not ready.",
      };
    }
  }
  const final = capture.attempted ? await readSidecarDiagnostics(baseUrl) : after;
  const validationPassed = diagnosticsReady(final) && (!cli.options.capture || capture.ok === true);
  const result = {
    ok: validationPassed,
    sidecarUrl: baseUrl,
    readyForReadOnlyCapture: diagnosticsReady(final),
    captureRequested: Boolean(cli.options.capture),
    pairConnectRequested: Boolean(cli.options["attempt-connect"]),
    displayChangingPushRequiresPermission: true,
    before,
    pairConnect,
    after,
    capture,
    final,
    elapsedMs: roundMs(performance.now() - started),
    logPath,
  };
  await appendJsonl(logPath, { event: "live-check", ...result });
  return result;
}

async function readSidecarDiagnostics(sidecarUrl: string): Promise<Record<string, unknown>> {
  const baseUrl = sidecarUrl.replace(/\/+$/, "");
  const started = performance.now();
  const [config, glasses, displaySurface] = await Promise.all([
    fetchSidecarJson(baseUrl + "/api/config"),
    fetchSidecarJson(baseUrl + "/api/glasses/status"),
    fetchSidecarJson(baseUrl + "/api/framebuffer/status"),
  ]);
  const configBody = asRecord(config.body);
  const glassesBody = asRecord(glasses.body);
  const surfaceBody = asRecord(displaySurface.body);
  const macBridge = asRecord(surfaceBody.macBridge);
  const geometry = asRecord(surfaceBody.geometry);
  const baseline = asRecord(surfaceBody.baseline);
  const frame = asRecord(surfaceBody.frame);
  const displayTransport = stringValue(surfaceBody.displayTransport) || stringValue(configBody.displayTransport);
  const macBridgeRunning = macBridge.running === true;
  const pairedCount = arrayLength(glassesBody.paired);
  const connectedCount = arrayLength(glassesBody.connected);
  const connectedReady = typeof connectedCount === "number" && connectedCount > 0;
  const transportReady = displayTransport === "mac";
  const geometryReady = geometry.width === 540 && geometry.height === 280;
  const baselineAvailable = baseline.available === true;
  return {
    ok: true,
    baseUrl,
    reachable: Boolean(config.ok || glasses.ok || displaySurface.ok),
    elapsedMs: roundMs(performance.now() - started),
    readyForReadOnlyCapture: Boolean(displaySurface.ok && transportReady && macBridgeRunning && connectedReady && geometryReady),
    displayChangingPushRequiresPermission: true,
    config: {
      ok: config.ok,
      status: config.status,
      displayTransport: stringValue(configBody.displayTransport),
      endpoints: pickStringFields(configBody, ["framebufferUrl", "realMirrorUrl", "mirrorRealUrl", "mirrorDemoUrl"]),
      error: config.error,
    },
    glasses: {
      ok: glasses.ok,
      status: glasses.status,
      pairedCount,
      connectedCount,
      connectedReady,
      knownCount: arrayLength(glassesBody.known),
      error: glasses.error,
    },
    displaySurface: {
      ok: displaySurface.ok,
      status: displaySurface.status,
      displayTransport,
      transportReady,
      geometry: pickNumberFields(geometry, ["width", "height", "bitsPerPixel", "pageSize", "pageCount", "bytes"]),
      geometryReady,
      baseline: {
        available: baselineAvailable,
        bytes: numberValue(baseline.bytes),
        expectedBytes: numberValue(baseline.expectedBytes),
      },
      macBridge: {
        running: macBridgeRunning,
      },
      frame: {
        available: frame.available === true,
        ageMs: numberValue(frame.ageMs),
        bytes: numberValue(frame.bytes),
      },
      error: displaySurface.error,
    },
    notes: [
      transportReady ? "Display transport is mac." : "Display transport is not mac; read-only capture is not currently ready.",
      macBridgeRunning ? "Mac bridge is running for read-only display capture." : "Mac bridge is not running; read-only capture is not currently ready.",
      "Real display-changing HUD pushes still require explicit operator permission.",
    ],
  };
}

async function captureReadOnlyFrame(baseUrl: string, cli: ParsedCli): Promise<Record<string, unknown>> {
  const pageStart = Number(cli.options["page-start"] || 184);
  const pageCount = Number(cli.options["page-count"] || 3);
  const response = await fetchSidecarJson(baseUrl + "/api/framebuffer/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pageStart,
      pageCount,
      includeRaw: true,
      readOnly: true,
      displayChanging: false,
      writeWithoutResponse: true,
      fastNoResponse: true,
      pipelineWindow: 8,
      sendDelayMs: 0,
      noInit: true,
    }),
  });
  const body = asRecord(response.body);
  const rawBase64 = stringValue(body.rawBase64);
  const rawBytes = rawBase64 ? Buffer.from(rawBase64, "base64") : Buffer.alloc(0);
  const highNibbleNonZeroBytes = rawBytes.length ? rawBytes.reduce((count, byte) => count + ((byte & 0xf0) ? 1 : 0), 0) : undefined;
  const captureSha256 = rawBytes.length ? sha256(rawBytes) : undefined;
  const state = asRecord(body.state);
  const macBridge = asRecord(state.macBridge);
  return {
    attempted: true,
    ok: response.ok && body.ok !== false,
    readOnly: true,
    displayChanging: false,
    status: response.status,
    error: response.error || stringValue(body.error) || stringValue(body.message),
    pageStart: numberValue(body.pageStart) ?? pageStart,
    pageCount: numberValue(body.pageCount) ?? pageCount,
    durationMs: numberValue(body.durationMs),
    rawBytes: rawBytes.length || numberValue(body.rawBytes),
    captureSha256,
    highNibbleNonZeroBytes,
    bridgeRunningAfterError: macBridge.running === true ? true : macBridge.running === false ? false : undefined,
  };
}

async function readFramebufferProof(baseUrl: string, cli: ParsedCli, phase: "before" | "after"): Promise<Record<string, unknown>> {
  const diagnostics = await readSidecarDiagnostics(baseUrl);
  if (!diagnosticsReady(diagnostics)) {
    return {
      phase,
      requested: true,
      ok: false,
      skipped: true,
      reason: "Sidecar framebuffer diagnostics are not ready.",
      readyForReadOnlyCapture: false,
      diagnostics,
    };
  }
  const capture = await captureReadOnlyFrame(baseUrl, cli);
  return {
    phase,
    requested: true,
    ok: capture.ok === true,
    readyForReadOnlyCapture: true,
    ...capture,
  };
}

async function fetchSidecarJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500 + (init?.method === "POST" ? 60_000 : 0));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { text: text.slice(0, 200) };
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function diagnosticsReady(diagnostics: Record<string, unknown>): boolean {
  return diagnostics.readyForReadOnlyCapture === true;
}

function summarizePairConnect(response: { ok: boolean; status?: number; body?: unknown; error?: string }): Record<string, unknown> {
  const body = asRecord(response.body);
  const steps = Array.isArray(body.steps)
    ? body.steps.map((item) => {
        const step = asRecord(item);
        return {
          name: stringValue(step.name),
          ok: step.ok === true,
          error: stringValue(step.error) || stringValue(step.message),
        };
      })
    : undefined;
  return {
    attempted: true,
    ok: response.ok && body.ok !== false,
    status: response.status,
    pairedCount: arrayLength(body.paired),
    connectedCount: arrayLength(body.connected),
    steps,
    error: response.error,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function pickStringFields(source: Record<string, unknown>, fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = stringValue(source[field]);
    if (value) out[field] = value;
  }
  return out;
}

function pickNumberFields(source: Record<string, unknown>, fields: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of fields) {
    const value = numberValue(source[field]);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

function capabilities(): unknown {
  return {
    ok: true,
    widgets: WIDGET_TYPES,
    commands: [
      "render-json",
      "push-json",
      "show-image",
      "clear",
      "status",
      "measure-latency",
      "hud --mock-display --text",
      "hud --mock-display --mic mac",
      "hud --mock-display --mic mac --asr-provider openai-realtime",
      "hud --real --text",
      "hud --real --mic mac",
      "hud --real --mic mac --hermes-cli --real-hermes",
      "hud --real --mic mac --asr-provider openai-realtime --hermes-cli --real-hermes",
      "asr-demo --mock-display --mock-hermes",
      "asr-demo --real --mock-hermes --framebuffer-check",
      "agents --mock",
      "agents --real",
      "hudctl show-json",
      "hudctl show-card",
      "hudctl clear",
      "hudctl status",
      "hudctl emit-agent-status",
      "live-check",
      "demo live-call",
      "demo blackjack",
      "demo conference",
      "demo agent",
      "diagnostics",
    ],
    display: PERIPHERAL_DISPLAY,
    realPush: "HUD runtime uses the existing macos_corebluetooth/peripheral-mac-pusher stdin raw-write bridge when --real is explicit. Legacy image commands still require --real-hardware-ok.",
  };
}

function loadAsrDemoScript(cli: ParsedCli, projectRoot: string): Record<string, unknown> & { steps: ScriptedTranscriptStep[] } {
  let source = "default";
  let scriptPath: string | undefined;
  let raw = [
    "Hermes CLI",
    "Summarize the current glasses HUD status in one sentence.",
    "Give me the next step in one sentence.",
  ].join("\n");

  if (typeof cli.options["asr-text"] === "string") {
    source = "inline";
    raw = cli.options["asr-text"];
  } else if (typeof cli.options.script === "string") {
    source = "file";
    scriptPath = resolve(projectRoot, cli.options.script);
    raw = readFileSync(scriptPath, "utf8");
  } else if (cli.positionals.length > 0) {
    source = "positionals";
    raw = cli.positionals.join("\n");
  }

  const steps = parseAsrDemoScript(raw);
  return {
    schema: "peripheral-asr-demo-script-v1",
    source,
    path: scriptPath,
    steps,
    stepCount: steps.length,
    sha256: sha256(JSON.stringify(steps)),
  };
}

function parseAsrDemoScript(raw: string): ScriptedTranscriptStep[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("ASR demo script is empty.");
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const items = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.steps) ? parsed.steps : null;
    if (!items) {
      throw new Error("ASR demo JSON script must be an array, or an object with a steps array.");
    }
    return normalizeAsrSteps(items);
  }
  return normalizeAsrSteps(parsePlainAsrDemoSteps(trimmed));
}

function parsePlainAsrDemoSteps(value: string): ScriptedTranscriptStep[] {
  const steps: ScriptedTranscriptStep[] = [];
  for (const rawLine of value.split(/\r?\n|\s*\|\s*/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const wait = line.match(/^@?wait\s+(\d+)(?:\s*ms)?$/i);
    if (wait) {
      if (!steps.length) throw new Error("ASR demo @wait must follow a transcript line.");
      steps[steps.length - 1] = { ...steps[steps.length - 1]!, waitMs: Number(wait[1]) };
      continue;
    }
    steps.push({ text: line });
  }
  return steps;
}

function normalizeAsrSteps(items: unknown[]): ScriptedTranscriptStep[] {
  const steps = items.map((item, index) => {
    if (typeof item === "string") {
      return { text: item };
    }
    if (isRecord(item) && typeof item.text === "string") {
      const waitMs = item.waitMs === undefined ? undefined : Math.max(0, Number(item.waitMs));
      if (waitMs !== undefined && !Number.isFinite(waitMs)) {
        throw new Error("ASR demo script waitMs at index " + index + " must be a number.");
      }
      return waitMs === undefined ? { text: item.text } : { text: item.text, waitMs };
    }
    throw new Error("ASR demo script item " + index + " must be a string or { text, waitMs }.");
  }).filter((step) => step.text.trim().length > 0);
  if (!steps.length) {
    throw new Error("ASR demo script must contain at least one transcript line.");
  }
  return steps;
}

function demoFlow(name: string): GlassWidget[] {
  switch (name) {
    case "live-call":
      return [
        widget("call-1", "live_call", "Sato Table", { status: "CALLING", transcript: [{ speaker: "agent", text: "Calling Sato Table for two at 7:30." }], facts: ["2 guests", "Tonight", "Window seat"] }),
        widget("call-2", "live_call", "Sato Table", { status: "CONNECTED", transcript: [{ speaker: "agent", text: "Hi, checking availability for two." }, { speaker: "other", text: "We have 7:45 or 8:15 available." }], facts: ["2 guests", "7:45 option", "Indoor"] }),
        widget("call-3", "live_call", "Sato Table", { status: "CONFIRMED", transcript: [{ speaker: "agent", text: "Please book 7:45 under Karim." }, { speaker: "other", text: "Confirmed. See you tonight." }], facts: ["Booked 7:45", "Name: Karim", "Confirm by SMS"] }),
      ];
    case "blackjack":
      return [
        widget("bj-1", "strategy_card", "Blackjack Basic", { player_hand: "A,7", dealer_card: "9", action: "HIT", body: "Soft 18 loses value against dealer 9. Take one card." }),
        widget("bj-2", "strategy_card", "Blackjack Basic", { player_hand: "10,6", dealer_card: "10", action: "SURRENDER", body: "If allowed, surrender 16 versus 10. Otherwise hit." }),
        widget("bj-3", "strategy_card", "Blackjack Basic", { player_hand: "9,9", dealer_card: "7", action: "STAND", body: "Pair of 9s stands into dealer 7." }),
      ];
    case "conference":
      return [
        widget("conf-list", "people_list", "Agent Picks", {
          footer: "OPENING #3",
          people: [
            { name: "Nora Chen", role: "Optics lead", company: "WaveLab", reason: "Near-eye display", score: "92" },
            { name: "Ilya Ramos", role: "Display transport", company: "PacketWorks", reason: "Wearable transport", score: "88" },
            { name: "Maya Lee", role: "Spatial UX", company: "FieldKit", reason: "Glanceable agents", score: "95" },
          ],
        }),
        widget("conf-detail", "person_detail", "Maya Lee", {
          name: "Maya Lee",
          role: "Spatial UX",
          company: "FieldKit",
          left_image: "maya_headshot.json",
          body: "Builds glanceable agent interfaces for industrial wearables.",
          facts: ["Ask about HUD cadence", "Knows approval UI", "Looking for display prototypes"],
          footer: "NEXT: INTRO AFTER TALK",
        }),
      ];
    case "agent":
      return [
        widget("agent-warn", "status_icon", "Agent Stuck", { status: "NEEDS APPROVAL", body: "The restaurant asked for a card hold.", icon: "warning" }),
        widget("agent-approval", "approval_card", "Approve Hold?", { status: "$25 CARD HOLD", body: "Sato Table can hold the booking with a refundable card authorization.", choices: [{ label: "Approve", tone: "primary" }, { label: "Deny" }, { label: "Details" }] }),
        widget("agent-done", "generic_card", "Decision Logged", { status: "APPROVED", body: "The agent can continue and confirm the reservation.", icon: "check", footer: "AUDIT: USER APPROVED" }),
      ];
    default:
      throw new Error("Unknown demo. Use one of: live-call, blackjack, conference, agent");
  }
}

function widget(id: string, type: GlassWidget["type"], title: string, rest: Partial<GlassWidget>): GlassWidget {
  return assertWidget({ id, type, title, created_at: new Date().toISOString(), ...rest });
}

function parseCli(argv: string[]): ParsedCli {
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (VALUE_FLAGS.has(key)) {
        const value = argv[i + 1];
        if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
        options[key] = value;
        i += 1;
      } else {
        options[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  const command = positionals.shift() || "";
  return { command, positionals, options };
}

function printHelp(): void {
  console.log(`peripheralctl - semantic widgets to Peripheral HUD frames

Usage:
  peripheralctl render-json <ui.json> --out <frame.png>
  peripheralctl push-json <ui.json> [--mock]
  peripheralctl show-image <frame.png> [--mock]
  peripheralctl clear [--mock]
  peripheralctl status [--mock]
  peripheralctl measure-latency [--mock]
  peripheralctl hud --mock-display --text
  peripheralctl hud --mock-display --text --hermes-cli
  peripheralctl hud --mock-display --mic mac
  peripheralctl hud --real --mic mac --hermes-cli --real-hermes
  peripheralctl hud --real --text
  peripheralctl hud --real --mic mac
  peripheralctl asr-demo --mock-display --mock-hermes
  peripheralctl asr-demo --real --mock-hermes [--framebuffer-check]
  peripheralctl agents --mock
  peripheralctl agents --real
  peripheralctl demo live-call [--mock]
  peripheralctl demo blackjack [--mock]
  peripheralctl demo conference [--mock]
  peripheralctl demo agent [--mock]
  peripheralctl diagnostics [--mock] [--sidecar-url http://127.0.0.1:8791]
  peripheralctl live-check [--attempt-connect --real-hardware-ok] [--capture] [--mock]

Global options:
  --mock                  Mock render/push transport; live-check still talks to the sidecar.
  --dry-run               Same safety posture as mock, labelled dry-run.
  --json                  Print machine-readable JSON.
  --log <path>            JSONL log path.
  --repo-root <path>      Repo root containing macos_corebluetooth.
  --sidecar-url <url>     Local sidecar URL for read-only display diagnostics.
  --script <path>         For asr-demo: newline text with @wait lines or JSON transcript steps.
  --asr-text <text>       For asr-demo: one line or pipe-separated transcript lines.
  --step-delay-ms <ms>    For asr-demo: delay after each transcript line.
  --attempt-connect       For live-check only: call the sidecar pair/connect route; requires --real-hardware-ok.
  --capture               For live-check only: run read-only capture when ready.
  --page-start <n>        For live-check capture; default 184.
  --page-count <n>        For live-check capture; default 3.
  --real-hardware-ok      Required for legacy real display commands without --real.

HUD runtime options:
  --mock-display          Render and log frames without touching the live display transport.
  --real                  Use the real display driver. Ask before using live.
  --text                  Read typed commands from stdin.
  --mic mac               Start Mac mic transcript source. Uses --stt-cmd, PERIPHERAL_HUD_STT_CMD, OpenAI Realtime when configured, or the bundled macOS Speech helper.
  --asr-provider <mode>   auto, openai-realtime, or macos-speech. Default auto.
  --stt-cmd <cmd>         Override the line-based STT command for --mic mac.
  --asr-locale <locale>   Locale for bundled macOS Speech helper; default en-US.
  --asr-silence-ms <ms>   Stable partial silence before emitting a transcript; default 1100.
  --asr-duration-seconds <n>
                           Stop bundled/helper STT after n seconds; useful for tests.
  --asr-partials          Log partial recognition text from the bundled helper to stderr/JSONL.
  --asr-http-port <port>  Also host a browser ASR page that POSTs transcripts into the HUD runtime.
  --openai-asr-model <id> OpenAI Realtime ASR model; default gpt-realtime-whisper.
  --openai-asr-protocol <mode>
                           auto, legacy, or current. auto uses legacy for gpt-realtime-*.
  --openai-env-file <path>
                           Dotenv file containing OPENAI_API_KEY.
  --openai-asr-ffmpeg-input <input>
                           ffmpeg avfoundation input for Mac mic; default auto.
  --mock-hermes           Force the mock Hermes adapter.
  --real-hermes           Force real Hermes when installed.
  --hermes-cli            Open the Hermes terminal view as the default HUD view.
  --framebuffer-check     For asr-demo: capture text-only framebuffer hashes before/after when the sidecar is ready.
  --cadence-ms <ms>       Minimum 700 ms; default 1400 ms.
`);
}

function printHudctlHelp(): void {
  console.log(`hudctl - direct controls for the Agent HUD runtime

Usage:
  hudctl show-json <file> [--real]
  hudctl show-card --title <title> --body <body> [--real]
  hudctl clear [--real]
  hudctl status [--real]
  hudctl emit-agent-status <agent> <status> [--real]

Status values:
  idle, launching, running, waiting, needs_attention, completed, error

Options:
  --json                  Print machine-readable JSON.
  --mock-display          Mock display driver; this is the default.
  --real                  Push rendered frames to the real glasses display.
  --real-hardware-ok      Required for legacy real display commands without --real.
  --project-root <path>   peripheral-hud-runtime root.
  --repo-root <path>      Repo root containing macos_corebluetooth.
`);
}

function assertRealHardwareGate(command: string, driverOptions: DriverOptions, realHardwareOk: boolean): void {
  const hardwareCommands = new Set(["push-json", "show-image", "clear", "demo", "measure-latency"]);
  if (!hardwareCommands.has(command)) return;
  if (driverOptions.mock || driverOptions.dryRun || realHardwareOk) return;
  throw new Error(`${command} without --mock requires --real-hardware-ok after explicit live-glasses permission.`);
}

function printResult(value: unknown, json: boolean): void {
  if (json || isRecord(value)) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(String(value));
}

function findProjectRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "fixtures", "ui"))) return current;
    const next = dirname(current);
    if (next === current) break;
    current = next;
  }
  return resolve(dirname(new URL(import.meta.url).pathname), "../../../..");
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function flagNumber(value: unknown, name: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(name + " must be a number.");
  }
  return Math.max(min, number);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
