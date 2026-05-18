#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { MAP_WIDGET_DISPLAY, PERIPHERAL_DISPLAY, WIDGET_TYPES, assertWidget, type PeripheralWidget, type SurfaceKind, type UserDecision } from "../../../packages/peripheral-protocol/src/index.js";
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
  runTextAsrReplay,
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
import {
  buildAgentCliMatrixWidget,
  buildAgentCockpitWidget,
  buildAgentModeDossier,
  buildBrokerTimeline,
  buildIntegrationSummary,
  buildConnectedGlassesEvidence,
  buildConnectedGlassesState,
  buildLiveAdapterCatalog,
  buildPeripheralHardwareProfile,
  buildPeripheralMcpManifest,
  buildIntegrationSupportReport,
  buildSponsorMatrixWidget,
} from "../../../packages/peripheral-integrations/src/index.js";
import {
  buildAgentBridgeAdapters,
  buildAgentBridgeDossier,
  buildAgentBridgeRuntimeHandshake,
  buildAgentBridgeSessionPack,
  buildAgentRuntimePlan,
  buildAgentBridgeTranscript,
  buildAgentLaunchSpecs,
  normalizeAgentCliId,
  routeAgentBridgeLine,
  runAgentCliLaunch,
  normalizeAgentCliLine,
  surfaceCommandForAgentEvent,
  widgetForAgentEvent,
} from "../../../packages/peripheral-agent-bridge/src/index.js";
import {
  agentModeLease,
  applySurfaceCommand,
  buildPhoneRuntimeSnapshot,
  createPhoneSurfaceRuntime,
  routeInputEvent,
} from "../../../packages/peripheral-phone-runtime/src/index.js";
import {
  buildSponsorWorkflowDossier,
  buildSponsorWorkflows,
  buildSponsorWorkflowWidgets,
  workflowForSponsor,
} from "../../../packages/peripheral-sponsor-workflows/src/index.js";
import {
  buildSponsorEventDossier,
  buildSponsorRuntimeAdapters,
  buildSponsorRuntimeRequest,
  createStripePaymentIntent,
  dispatchSponsorEvent,
  normalizeBrowserUseEvent,
  normalizeGeminiRoute,
  normalizeSponsorEvent,
  routeWithGemini,
  runBrowserUseTask,
  saveDinnerPreference,
  sendAgentMailConfirmation,
  submitSpongeContext,
  type AgentMailConfirmationRequest,
  type SponsorEventInput,
  type SponsorRuntimeRequest,
  type SupermemoryPreferenceRequest,
} from "../../../packages/peripheral-sponsor-kit/src/index.js";
import { normalizeAgentPhoneEvent, runAgentPhoneDinnerBooking, type AgentPhoneDinnerRequest } from "../../../packages/peripheral-sponsor-kit/src/agentphone.js";

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
  "hermes-tmux-session",
  "hermes-model",
  "hermes-reasoning",
  "timeout-seconds",
  "timeout-ms",
  "agent",
  "sponsor",
  "event",
  "session-id",
  "memory-session-id",
  "session-prefix",
  "line",
  "transcript-uri",
  "payload-json",
  "payload-file",
  "summary",
  "task",
  "start-url",
  "browser-model",
  "profile-id",
  "workspace-id",
  "max-cost-usd",
  "proxy-country",
  "approval-intent",
  "gemini-model",
  "focused-card",
  "active-agents",
  "risk",
  "amount",
  "currency",
  "description",
  "customer",
  "payment-method",
  "target",
  "goal",
  "url",
  "max-steps",
  "approval-policy",
  "prompt",
  "context",
  "context-text",
  "cwd",
  "model",
  "project-id",
  "mode",
  "process-command",
  "process-args-json",
  "code",
  "choice",
  "restaurant-name",
  "restaurant-phone",
  "party-size",
  "neighborhood",
  "booking-name",
  "preferred-window",
  "booking-time",
  "hold-amount",
  "email-to",
  "email-from",
  "memory-container",
  "wearer-name",
  "preference",
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
    local: Boolean(cli.options.local || cli.options["local-display"] || (cli.command === "demo" && !cli.options.real)),
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
    case "review-bundle":
      result = commandReviewBundle(projectRoot, repoRoot);
      break;
    case "walkthrough":
      result = await commandWalkthrough(cli, projectRoot, driverOptions);
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
    case "asr-replay":
      result = await commandAsrReplay(cli, projectRoot, repoRoot, logPath);
      break;
    case "agents":
      result = await commandAgents(cli, projectRoot, repoRoot, logPath);
      break;
    case "integrations":
      result = await commandIntegrations(cli, projectRoot);
      break;
    case "agent-bridge":
      result = await commandAgentBridge(cli, projectRoot, repoRoot, logPath);
      break;
    case "phone-runtime":
      result = await commandPhoneRuntime(cli, projectRoot);
      break;
    case "sponsor-workflows":
      result = await commandSponsorWorkflows(cli, projectRoot);
      break;
    case "sponsor-runtime":
      result = await commandSponsorRuntime(cli, projectRoot);
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

async function commandAsrReplay(cli: ParsedCli, projectRoot: string, repoRoot: string, logPath: string): Promise<unknown> {
  const options: HudRuntimeOptions = { ...runtimeOptions(cli, projectRoot, repoRoot, logPath), inputMode: "scripted_asr" };
  const script = loadAsrReplayScript(cli, projectRoot);
  const baseUrl = String(cli.options["sidecar-url"] || "http://127.0.0.1:8791").replace(/\/+$/, "");
  const stepDelayMs = Math.max(0, Number(cli.options["step-delay-ms"] || options.cadenceMs || 1400));
  if (!Number.isFinite(stepDelayMs)) {
    throw new Error("--step-delay-ms must be a number.");
  }
  const proofBefore = cli.options["framebuffer-check"] ? await readFramebufferProof(baseUrl, cli, "before") : null;
  const result = await runTextAsrReplay(options, {
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
  await appendJsonl(logPath, { event: "asr-replay", script, result, framebufferProof });
  return { ...result, script, framebufferProof };
}

function commandReviewBundle(projectRoot: string, repoRoot: string): unknown {
  const now = new Date();
  const frameDir = join(projectRoot, "out", "frames", "dinner-booking");
  const timelinePath = join(projectRoot, "out", "demo", "dinner-booking-timeline.json");
  const logPath = join(projectRoot, "out", "logs", "dinner-booking.jsonl");
  const videoPath = join(repoRoot, "docs", "media", "peripheral-demo-dinner-booking.mp4");
  const frames = existsSync(frameDir)
    ? readdirSync(frameDir).filter((name) => name.endsWith(".png")).sort()
    : [];
  const timeline = readJsonIfPresent(timelinePath);
  const timelineRecords = Array.isArray(timeline)
    ? timeline
    : isRecord(timeline) && Array.isArray(timeline.steps) ? timeline.steps
      : isRecord(timeline) && Array.isArray(timeline.timeline) ? timeline.timeline : [];
  const timelineText = timeline ? JSON.stringify(timeline) : "";
  const logLineCount = existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean).length : 0;
  const connectedState = buildConnectedGlassesState(now, buildConnectedGlassesEvidence(process.env, now));
  const phoneRuntime = buildPhoneRuntimeSnapshot(now);
  const integrationSummary = buildIntegrationSummary();
  const supportReport = buildIntegrationSupportReport(process.env, now);
  const liveAdapterCatalog = buildLiveAdapterCatalog(now);
  const agentRoute = routeAgentBridgeLine({
    agentId: "codex_cli",
    sessionId: "review-bundle",
    line: "Codex needs approval to run npm test.",
    now,
  });
  const agentPhoneDecision = applySurfaceCommand(createPhoneSurfaceRuntime(now), agentRoute.command, now);
  const artifacts = {
    frameDir,
    frameCount: frames.length,
    frames,
    timeline: artifactMeta(timelinePath, "json"),
    log: { ...artifactMeta(logPath, "jsonl"), lineCount: logLineCount },
    video: artifactMeta(videoPath, "mp4"),
  };
  const checks = [
    { id: "frames_generated", ok: frames.length >= 5, detail: frames.length + " PNG frames" },
    { id: "timeline_present", ok: Boolean(artifacts.timeline.exists), detail: timelinePath },
    { id: "approval_gate_recorded", ok: /approval_required|WAITING_FOR_APPROVAL/.test(timelineText), detail: "approval card appears in timeline" },
    { id: "followup_recorded", ok: /agentmail_confirmation/.test(timelineText) && /supermemory_saved/.test(timelineText), detail: "email and memory follow-up events present" },
    { id: "log_present", ok: logLineCount > 0, detail: logLineCount + " JSONL records" },
    { id: "video_present", ok: Boolean(artifacts.video.exists), detail: videoPath },
    { id: "connected_state_included", ok: connectedState.schema === "peripheral-connected-state-v1", detail: "phone-gateway glasses state is embedded" },
    { id: "phone_runtime_included", ok: phoneRuntime.schema === "peripheral-phone-runtime-snapshot-v1", detail: "phone surface runtime is embedded" },
    { id: "agent_route_included", ok: agentPhoneDecision.accepted, detail: "agent CLI route passes through the phone lease arbiter" },
  ];
  return {
    ok: checks.every((check) => check.ok),
    schema: "peripheral-review-bundle-v1",
    generatedAt: now.toISOString(),
    flow: "dinner-booking",
    experience: {
      primarySurface: "Peripheral glasses",
      browserPreviewSurface: false,
      reviewSurface: "rendered_glasses_frames",
      accessSurface: "glasses_only",
      displayOwnership: "phone_runtime_surface_lease",
      agentOutput: "semantic_surface_commands",
      liveTransportPolicy: "explicit_operator_choice_only",
    },
    commands: {
      generate: "npm --prefix peripheral-hud-runtime run peripheralctl -- demo dinner-booking --local --json",
      inspect: "npm --prefix peripheral-hud-runtime run peripheralctl -- review-bundle --json",
      approve: "npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime decide --event booking-approval-1 --choice approve",
      connectedState: "npm --prefix peripheral-hud-runtime run peripheralctl -- integrations connected-state --json",
      phoneRuntime: "npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime snapshot --json",
      support: "npm --prefix peripheral-hud-runtime run peripheralctl -- integrations support --json",
      liveAdapters: "npm --prefix peripheral-hud-runtime run peripheralctl -- integrations live-adapters --json",
      agentPhoneCall: "npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime agentphone-call --restaurant-phone +14155550137 --prompt \"Book dinner for two and pause before confirming\" --json",
      agentMailSend: "npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime agentmail-send --restaurant-name \"Sato Table\" --preferred-window 7:45 --booking-name Karim --json",
      supermemorySave: "npm --prefix peripheral-hud-runtime run peripheralctl -- sponsor-runtime supermemory-save --preference \"Prefers 7-8pm dinner slots\" --memory-container dinner-preferences --json",
      agentRoute: "npm --prefix peripheral-hud-runtime run peripheralctl -- agent-bridge route --agent codex_cli --session-id review-bundle --line \"Codex needs approval to run npm test.\" --json",
    },
    artifacts,
    timeline: {
      stepCount: timelineRecords.length,
      approvalSteps: timelineRecords.filter((item) => JSON.stringify(item).includes("approval_required")).length,
    },
    runtime: {
      hardwareAccessRequired: false,
      connectedState: {
        schema: connectedState.schema,
        mode: connectedState.mode,
        glasses: connectedState.glasses,
        phone: connectedState.phone,
        broker: {
          connected: connectedState.broker.connected,
          policy: connectedState.broker.policy,
          activeLeaseId: connectedState.broker.activeLease.id,
        },
        surfaceCommandCount: connectedState.surfaceCommands.length,
        widgetIds: connectedState.widgets.map((widget) => widget.id),
      },
      phoneRuntime: {
        schema: phoneRuntime.schema,
        mode: phoneRuntime.state.mode,
        activeLeaseId: phoneRuntime.state.activeLease.id,
        routingOrder: phoneRuntime.routingOrder,
      },
      adapterCoverage: {
        integrations: supportReport.totals.integrations,
        supported: supportReport.totals.supported,
        credentialNames: supportReport.totals.credentialNames,
        liveReady: supportReport.totals.liveReady,
        operationCataloged: liveAdapterCatalog.totals.operationCataloged,
        sponsorAdapters: integrationSummary.counts.sponsorCount,
        agentCliAdapters: integrationSummary.counts.agentCliCount,
        sponsorIds: integrationSummary.sponsors.map((sponsor) => sponsor.id),
        agentCliIds: integrationSummary.agentClis.map((agent) => agent.id),
        credentialMode: "operator_environment_bound",
      },
      agentBridge: {
        schema: agentRoute.schema,
        eventKind: agentRoute.event.kind,
        commandKind: agentRoute.command.kind,
        surface: agentRoute.command.surface,
        decisionRequired: Boolean(agentRoute.command.decision_required),
        widgetId: agentRoute.widget.id,
        phoneDecision: {
          accepted: agentPhoneDecision.accepted,
          nextLeaseId: agentPhoneDecision.nextLeaseId,
          focusedCardId: agentPhoneDecision.state.focusedCardId,
          focusedWidgetId: agentPhoneDecision.state.focusedWidgetId,
        },
      },
    },
    checks,
  };
}

async function commandAgents(cli: ParsedCli, projectRoot: string, repoRoot: string, logPath: string): Promise<unknown> {
  const options = runtimeOptions(cli, projectRoot, repoRoot, logPath);
  return listAgents(options);
}

async function commandIntegrations(cli: ParsedCli, projectRoot: string): Promise<unknown> {
  const view = cli.positionals[0] || "summary";
  const now = new Date();
  switch (view) {
    case "summary":
      return { ok: true, ...buildIntegrationSummary() };
    case "sponsors":
      return { ok: true, sponsors: buildIntegrationSummary().sponsors };
    case "agent-clis":
      return { ok: true, agentClis: buildIntegrationSummary().agentClis };
    case "connected-state":
      return { ok: true, connectedState: buildConnectedGlassesState(now, buildConnectedGlassesEvidence(process.env, now)) };
    case "hardware-profile":
      return { ok: true, hardware: buildPeripheralHardwareProfile(now) };
    case "support":
      return { ok: true, support: buildIntegrationSupportReport(process.env, now) };
    case "live-adapters":
      return { ok: true, liveAdapters: buildLiveAdapterCatalog(now) };
    case "mcp-manifest":
      return { ok: true, manifest: buildPeripheralMcpManifest(now) };
    case "broker-timeline":
      return { ok: true, timeline: buildBrokerTimeline(now) };
    case "sponsor-events":
      return { ok: true, sponsorEvents: buildSponsorEventDossier(now) };
    case "phone-runtime":
      return { ok: true, runtime: buildPhoneRuntimeSnapshot(now) };
    case "dossier":
      return { ok: true, dossier: buildAgentModeDossier(now) };
    case "widgets": {
      const frameDir = join(projectRoot, "out", "frames", "integrations");
      const widgets = [
        buildAgentCockpitWidget(now),
        buildSponsorMatrixWidget(now),
        buildAgentCliMatrixWidget(now),
      ];
      const artifacts = widgets.map((widget, index) => renderWidgetToFile(widget, join(frameDir, `${String(index + 1).padStart(2, "0")}-${widget.id}.png`), {
        assetRoot: join(projectRoot, "fixtures", "images"),
      }));
      return { ok: true, view, frames: frameDir, widgets: widgets.map((widget) => widget.id), artifacts };
    }
    default:
      throw new Error("Unknown integrations view. Use one of: summary, sponsors, agent-clis, connected-state, hardware-profile, support, live-adapters, mcp-manifest, broker-timeline, sponsor-events, phone-runtime, dossier, widgets");
  }
}

async function commandAgentBridge(cli: ParsedCli, projectRoot: string, repoRoot: string, logPath: string): Promise<unknown> {
  const view = cli.positionals[0] || "dossier";
  const now = new Date();
  switch (view) {
    case "adapters":
      return { ok: true, adapters: buildAgentBridgeAdapters() };
    case "launch-specs":
      return { ok: true, launchSpecs: buildAgentLaunchSpecs() };
    case "runtime-plan": {
      const agentId = cli.options.agent || cli.positionals[1]
        ? normalizeAgentCliId(String(cli.options.agent || cli.positionals[1]))
        : undefined;
      const sessionId = String(cli.options["session-id"] || cli.positionals[2] || "agent-session");
      return { ok: true, runtimePlan: buildAgentRuntimePlan(now, agentId, sessionId) };
    }
    case "launch": {
      const agentId = normalizeAgentCliId(String(cli.options.agent || cli.positionals[1] || "codex_cli"));
      const sessionId = String(cli.options["session-id"] || cli.positionals[2] || "agent-session");
      const task = String(cli.options.task || cli.options.line || cli.positionals.slice(3).join(" ") || "Start an agent task and route progress to the glasses.");
      const timeoutMs = Number(cli.options["timeout-ms"] || 15_000);
      const launchLogPath = resolve(String(cli.options.log || logPath));
      const result = runAgentCliLaunch({
        agentId,
        sessionId,
        task,
        cwd: typeof cli.options.cwd === "string" ? resolve(cli.options.cwd) : repoRoot,
        now,
      }, {
        execute: Boolean(cli.options.execute),
        commandOverride: typeof cli.options["process-command"] === "string" ? cli.options["process-command"] : undefined,
        argsOverride: typeof cli.options["process-args-json"] === "string" ? parseStringArray(cli.options["process-args-json"], "--process-args-json") : undefined,
        env: process.env,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        transcriptUri: launchLogPath,
      });
      await appendJsonl(launchLogPath, { event: "agent-bridge.launch", result });
      for (const route of result.routes) {
        await appendJsonl(launchLogPath, {
          event: "agent-bridge.launch.route",
          sessionId,
          agentId,
          route,
        });
      }
      return { ok: result.ok, launch: { ...result, logPath: launchLogPath } };
    }
    case "transcript":
      return { ok: true, transcript: buildAgentBridgeTranscript(now) };
    case "session-pack": {
      const sessionPrefix = String(cli.options["session-prefix"] || cli.options["session-id"] || "review");
      const pack = buildAgentBridgeSessionPack(now, sessionPrefix);
      const frameDir = join(projectRoot, "out", "frames", "agent-bridge-session");
      const artifacts = pack.agents.map((agent, index) => renderWidgetToFile(agent.widget, join(frameDir, String(index + 1).padStart(2, "0") + "-" + agent.id + "-" + agent.widget.id + ".png"), {
        assetRoot: join(projectRoot, "fixtures", "images"),
      }));
      const packPath = join(projectRoot, "out", "agent-bridge", "session-pack.json");
      mkdirSync(dirname(packPath), { recursive: true });
      writeFileSync(packPath, JSON.stringify({ ...pack, frames: artifacts }, null, 2));
      return { ok: true, sessionPack: pack, frameDir, packPath, artifacts };
    }
    case "event": {
      const agentId = normalizeAgentCliId(String(cli.options.agent || cli.positionals[1] || "codex_cli"));
      const sessionId = String(cli.options["session-id"] || cli.positionals[2] || "review-session");
      const line = String(cli.options.line || cli.positionals.slice(3).join(" ") || "Codex needs approval to run npm test.");
      const event = normalizeAgentCliLine({ agentId, sessionId, line, now });
      return { ok: true, event, widget: event.widget || widgetForAgentEvent(event, now) };
    }
    case "route": {
      const agentId = normalizeAgentCliId(String(cli.options.agent || cli.positionals[1] || "codex_cli"));
      const sessionId = String(cli.options["session-id"] || cli.positionals[2] || "review-session");
      const line = String(cli.options.line || cli.positionals.slice(3).join(" ") || "Codex needs approval to run npm test.");
      const route = routeAgentBridgeLine({ agentId, sessionId, line, now });
      const initialState = createPhoneSurfaceRuntime(now);
      const decision = applySurfaceCommand(initialState, route.command, now);
      return { ok: true, route, initialState, decision };
    }
    case "session": {
      const agentId = normalizeAgentCliId(String(cli.options.agent || cli.positionals[1] || "codex_cli"));
      const sessionId = String(cli.options["session-id"] || cli.positionals[2] || "review-session");
      const line = String(cli.options.line || cli.positionals.slice(3).join(" ") || "Codex needs approval to run npm test.");
      const handshake = buildAgentBridgeRuntimeHandshake({
        agentId,
        sessionId,
        line,
        transcriptUri: typeof cli.options["transcript-uri"] === "string" ? cli.options["transcript-uri"] : undefined,
        choice: agentBridgeChoice(cli),
        now,
      });
      const initialState = createPhoneSurfaceRuntime(now);
      const phoneRuntime = applySurfaceCommand(initialState, handshake.route.command, now);
      const frameDir = join(projectRoot, "out", "frames", "agent-bridge", slug(sessionId));
      const artifact = renderWidgetToFile(handshake.route.widget, join(frameDir, "01-" + slug(handshake.route.event.kind) + ".png"), {
        assetRoot: join(projectRoot, "fixtures", "images"),
      });
      const runtimePath = join(projectRoot, "out", "agent-bridge", slug(sessionId) + "-runtime.json");
      mkdirSync(dirname(runtimePath), { recursive: true });
      const payload = {
        ok: true,
        sessionId,
        agentId,
        handshake,
        phoneRuntime,
        artifact,
        runtimePath,
        logPath: join(projectRoot, "out", "logs", "agent-bridge.jsonl"),
      };
      writeFileSync(runtimePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
      await appendJsonl(payload.logPath, { event: "agent-bridge.session", sessionId, agentId, handshake, phoneRuntime, artifact });
      return payload;
    }
    case "widget": {
      const agentId = normalizeAgentCliId(String(cli.options.agent || cli.positionals[1] || "codex_cli"));
      const sessionId = String(cli.options["session-id"] || cli.positionals[2] || "review-session");
      const line = String(cli.options.line || cli.positionals.slice(3).join(" ") || "Codex needs approval to run npm test.");
      const event = normalizeAgentCliLine({ agentId, sessionId, line, now });
      const widget = event.widget || widgetForAgentEvent(event, now);
      const frameDir = join(projectRoot, "out", "frames", "agent-bridge");
      const artifact = renderWidgetToFile(widget, join(frameDir, widget.id + ".png"), {
        assetRoot: join(projectRoot, "fixtures", "images"),
      });
      return { ok: true, event, widget, artifact };
    }
    case "dossier":
      return { ok: true, bridge: buildAgentBridgeDossier(now) };
    default:
      throw new Error("Unknown agent-bridge view. Use one of: dossier, adapters, launch-specs, runtime-plan, launch, transcript, session-pack, event, route, session, widget");
  }
}

async function commandPhoneRuntime(cli: ParsedCli, projectRoot: string): Promise<unknown> {
  const view = cli.positionals[0] || "snapshot";
  const now = new Date();
  switch (view) {
    case "snapshot":
      return { ok: true, runtime: buildPhoneRuntimeSnapshot(now) };
    case "lease": {
      const state = createPhoneSurfaceRuntime(now);
      const event = normalizeAgentCliLine({
        agentId: normalizeAgentCliId(String(cli.options.agent || cli.positionals[1] || "codex_cli")),
        sessionId: String(cli.options["session-id"] || cli.positionals[2] || "review-session"),
        line: String(cli.options.line || "Codex needs approval to run npm test."),
        now,
      });
      const widget = event.widget || widgetForAgentEvent(event, now);
      const command = surfaceCommandForAgentEvent({ ...event, widget }, now);
      const decision = applySurfaceCommand(state, command, now);
      return { ok: true, initialState: state, command, decision };
    }
    case "route": {
      const state = createPhoneSurfaceRuntime(now);
      const event = {
        kind: "voice_text" as const,
        id: "input-" + now.getTime(),
        mode: state.mode,
        text: String(cli.options.line || cli.positionals.slice(1).join(" ") || "hey codex show status"),
        timestamp: now.toISOString(),
      };
      return { ok: true, route: routeInputEvent(state, event) };
    }
    case "agent-mode-lease":
      return { ok: true, lease: agentModeLease(String(cli.options.line || "User entered Agent Mode."), now) };
    case "ingest": {
      const route = phoneRuntimeIngestRoute(cli, now);
      const initialState = createPhoneSurfaceRuntime(now);
      const decision = applySurfaceCommand(initialState, route.command, now);
      const frameDir = join(projectRoot, "out", "frames", "phone-runtime-ingest");
      const artifact = renderWidgetToFile(route.widget, join(frameDir, slug(route.event.id) + ".png"), {
        assetRoot: join(projectRoot, "fixtures", "images"),
      });
      const ingestLogPath = resolve(String(cli.options.log || defaultLogPath(projectRoot, "phone-runtime-ingest")));
      const payload = {
        ok: decision.accepted,
        schema: "peripheral-phone-runtime-ingest-v1",
        source: route.event.source,
        event: route.event,
        widget: route.widget,
        command: route.command,
        decision,
        artifact,
        logPath: ingestLogPath,
      };
      await appendJsonl(ingestLogPath, { event: "phone-runtime.ingest", payload });
      return payload;
    }
    case "decide": {
      const decision = buildApprovalDecision(cli, now);
      const decisionPath = writeApprovalDecision(projectRoot, decision);
      const decisionLogPath = join(projectRoot, "out", "demo", "approval-decisions.jsonl");
      await appendJsonl(decisionLogPath, { event: "phone_runtime.decision", decision, decisionPath });
      return {
        ok: true,
        decision,
        decisionPath,
        decisionLogPath,
        appliesTo: decision.event_id,
      };
    }
    default:
      throw new Error("Unknown phone-runtime view. Use one of: snapshot, lease, route, agent-mode-lease, ingest, decide");
  }
}

function phoneRuntimeIngestRoute(cli: ParsedCli, now: Date) {
  const payload = runtimeIngestPayload(cli);
  const source = String(payload.source || payload.kind || "");
  const agentIdValue = payload.agentId || payload.agent_id || cli.options.agent;
  const isAgent = Boolean(agentIdValue) || source === "agent" || source === "agent_cli";
  const sessionId = String(payload.sessionId || payload.session_id || cli.options["session-id"] || cli.positionals[2] || "runtime-ingest");
  if (isAgent) {
    return routeAgentBridgeLine({
      agentId: normalizeAgentCliId(String(agentIdValue || "codex_cli")),
      sessionId,
      line: String(payload.line || payload.summary || cli.options.line || cli.options.summary || "Agent needs approval to continue."),
      transcriptUri: typeof payload.transcriptUri === "string" ? payload.transcriptUri : typeof cli.options["transcript-uri"] === "string" ? cli.options["transcript-uri"] : undefined,
      now,
    });
  }
  const sponsorId = String(payload.sponsorId || payload.sponsor_id || payload.sponsor || cli.options.sponsor || cli.positionals[1] || "agentphone") as SponsorEventInput["sponsorId"];
  const event = String(payload.event || payload.eventName || payload.event_name || cli.options.event || cli.positionals[2] || defaultEventForRuntimeIngest(sponsorId)) as SponsorEventInput["event"];
  return normalizeSponsorEvent({
    sponsorId,
    event,
    sessionId,
    title: stringFromUnknown(payload.title) || (typeof cli.options.title === "string" ? cli.options.title : undefined),
    summary: String(payload.summary || payload.text || cli.options.summary || cli.options.line || "Runtime event routed to the glasses."),
    risk: (stringFromUnknown(payload.risk) || (typeof cli.options.risk === "string" ? cli.options.risk : undefined)) as SponsorEventInput["risk"],
    amount: stringFromUnknown(payload.amount) || (typeof cli.options.amount === "string" ? cli.options.amount : undefined),
    target: stringFromUnknown(payload.target) || (typeof cli.options.target === "string" ? cli.options.target : undefined),
    code: stringFromUnknown(payload.code) || (typeof cli.options.code === "string" ? cli.options.code : undefined),
    now,
  });
}

function runtimeIngestPayload(cli: ParsedCli): Record<string, unknown> {
  if (typeof cli.options["payload-file"] === "string") {
    const parsed = JSON.parse(readFileSync(resolve(cli.options["payload-file"]), "utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("--payload-file must contain a JSON object.");
    return parsed;
  }
  if (typeof cli.options["payload-json"] === "string") {
    const parsed = JSON.parse(cli.options["payload-json"]) as unknown;
    if (!isRecord(parsed)) throw new Error("--payload-json must be a JSON object.");
    return parsed;
  }
  return {};
}

function defaultEventForRuntimeIngest(sponsorId: SponsorEventInput["sponsorId"]): SponsorEventInput["event"] {
  if (sponsorId === "stripe") return "payment_intent_requires_action";
  if (sponsorId === "agentmail") return "draft_ready";
  if (sponsorId === "supermemory") return "memory_saved";
  if (sponsorId === "browser_use") return "browser_step";
  if (sponsorId === "sponge") return "context_clustered";
  if (sponsorId === "gemini") return "route_decision";
  return "call_connected";
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildApprovalDecision(cli: ParsedCli, now: Date): UserDecision {
  const eventId = String(cli.options.event || cli.positionals[1] || "booking-approval-1");
  const choice = String(cli.options.choice || cli.positionals[2] || "approve");
  const decision = choice === "deny" ? "deny" : choice === "details" ? "details" : "approve";
  return {
    kind: "approval_decision",
    event_id: eventId,
    session_id: String(cli.options["session-id"] || "dinner-booking"),
    decision,
    choice_id: decision,
    confirmation_level: cli.options.phone ? "phone" : "voice_and_tap",
    reason: String(cli.options.summary || "Decision captured by phone runtime."),
    source: {
      id: "phone-runtime",
      label: "Phone Runtime",
      kind: "system",
      vendor: "Peripheral",
      trust: "local",
    },
    timestamp: now.toISOString(),
  };
}

function agentBridgeChoice(cli: ParsedCli): "approve" | "deny" | "details" {
  const choice = String(cli.options.choice || "approve").toLowerCase();
  return choice === "deny" ? "deny" : choice === "details" ? "details" : "approve";
}

async function commandSponsorWorkflows(cli: ParsedCli, projectRoot: string): Promise<unknown> {
  const view = cli.positionals[0] || "dossier";
  const now = new Date();
  switch (view) {
    case "list":
      return { ok: true, workflows: buildSponsorWorkflows() };
    case "workflow": {
      const sponsor = cli.positionals[1];
      if (!sponsor) throw new Error("sponsor-workflows workflow requires <sponsor-id>.");
      return { ok: true, workflow: workflowForSponsor(sponsor) };
    }
    case "widgets": {
      const frameDir = join(projectRoot, "out", "frames", "sponsor-workflows");
      const widgets = buildSponsorWorkflowWidgets(now);
      const artifacts = widgets.map((widget, index) => renderWidgetToFile(widget, join(frameDir, `${String(index + 1).padStart(2, "0")}-${widget.id}.png`), {
        assetRoot: join(projectRoot, "fixtures", "images"),
      }));
      return { ok: true, widgets, artifacts, frames: frameDir };
    }
    case "dossier":
      return { ok: true, dossier: buildSponsorWorkflowDossier(now) };
    default:
      throw new Error("Unknown sponsor-workflows view. Use one of: dossier, list, workflow, widgets");
  }
}

async function commandSponsorRuntime(cli: ParsedCli, projectRoot: string): Promise<unknown> {
  const view = cli.positionals[0] || "adapters";
  const now = new Date();
  switch (view) {
    case "adapters":
      return { ok: true, adapters: buildSponsorRuntimeAdapters(process.env) };
    case "request": {
      const request = buildSponsorRuntimeRequest(sponsorRuntimeInput(cli, now), process.env);
      return { ok: true, request: redactSponsorRuntimeRequest(request) };
    }
    case "dispatch": {
      const input = sponsorRuntimeInput(cli, now);
      const result = await dispatchSponsorEvent(input, process.env, fetch, sponsorRuntimeForceReal(cli, input.sponsorId));
      return {
        ...result,
        request: redactSponsorRuntimeRequest(result.request),
      };
    }
    case "agentphone-call": {
      const request: AgentPhoneDinnerRequest = {
        restaurantName: String(cli.options["restaurant-name"] || cli.options.target || "Sato Table"),
        restaurantPhoneNumber: String(cli.options["restaurant-phone"] || process.env.AGENTPHONE_RESTAURANT_PHONE || process.env.PERIPHERAL_RESTAURANT_PHONE || ""),
        partySize: Math.max(1, Number(cli.options["party-size"] || process.env.PERIPHERAL_PARTY_SIZE || 2)),
        neighborhood: String(cli.options.neighborhood || process.env.PERIPHERAL_NEIGHBORHOOD || "Mission"),
        bookingName: String(cli.options["booking-name"] || process.env.PERIPHERAL_BOOKING_NAME || process.env.PERIPHERAL_WEARER_NAME || "Wearer"),
        preferredWindow: String(cli.options["preferred-window"] || process.env.PERIPHERAL_PREFERRED_WINDOW || "7:45"),
        prompt: String(cli.options.prompt || cli.options.task || cli.options.summary || "Book dinner for two tonight and pause on Peripheral glasses before confirming."),
        now,
      };
      const result = await runAgentPhoneDinnerBooking(request, {
        forceReal: Boolean(cli.options["real-agentphone"] || cli.options.real),
        env: process.env,
      });
      const normalized = result.events.map(normalizeAgentPhoneEvent);
      const primary = normalized.find((item) => item.command.decision_required) || normalized[0];
      return {
        ok: result.ok,
        mode: result.mode,
        agentPhone: result,
        request,
        event: primary?.event,
        widget: primary?.widget,
        command: primary?.command,
        events: normalized.map((item) => item.event),
        widgets: normalized.map((item) => item.widget),
        commands: normalized.map((item) => item.command),
      };
    }
    case "agentmail-send": {
      const input = agentMailConfirmationInput(cli, now);
      const result = await sendAgentMailConfirmation(input, {
        forceReal: Boolean(cli.options["real-agentmail"] || cli.options.real),
        env: process.env,
      });
      const summary = String(result.requestBody.text || "Confirmation email sent for " + input.bookingTime + " dinner at " + input.restaurantName + ".");
      const normalized = normalizeSponsorEvent({
        sponsorId: "agentmail",
        event: "reply_sent",
        sessionId: input.sessionId,
        title: "Confirmation Sent",
        summary,
        risk: "low",
        now,
      });
      return { ok: result.ok, mode: result.mode, agentMail: result, event: normalized.event, widget: normalized.widget, command: normalized.command };
    }
    case "supermemory-save": {
      const input = supermemoryPreferenceInput(cli, now);
      const result = await saveDinnerPreference(input, {
        forceReal: Boolean(cli.options["real-supermemory"] || cli.options.real),
        env: supermemoryRuntimeEnv(cli),
      });
      const normalized = normalizeSponsorEvent({
        sponsorId: "supermemory",
        event: "memory_saved",
        sessionId: input.sessionId,
        title: "Preference Saved",
        summary: input.preference,
        risk: "low",
        now,
      });
      return { ok: result.ok, mode: result.mode, supermemory: result, event: normalized.event, widget: normalized.widget, command: normalized.command };
    }
    case "followup-pack": {
      const mailInput = agentMailConfirmationInput(cli, now);
      const memoryInput = supermemoryPreferenceInput(cli, now);
      const mailResult = await sendAgentMailConfirmation(mailInput, {
        forceReal: Boolean(cli.options["real-agentmail"] || cli.options.real),
        env: process.env,
      });
      const memoryResult = await saveDinnerPreference(memoryInput, {
        forceReal: Boolean(cli.options["real-supermemory"] || cli.options.real),
        env: supermemoryRuntimeEnv(cli),
      });
      const mail = normalizeSponsorEvent({
        sponsorId: "agentmail",
        event: "reply_sent",
        sessionId: mailInput.sessionId,
        title: "Confirmation Sent",
        summary: String(mailResult.requestBody.text || "Confirmation email sent for " + mailInput.bookingTime + " dinner at " + mailInput.restaurantName + "."),
        risk: "low",
        now,
      });
      const memory = normalizeSponsorEvent({
        sponsorId: "supermemory",
        event: "memory_saved",
        sessionId: memoryInput.sessionId,
        title: "Preference Saved",
        summary: memoryInput.preference,
        risk: "low",
        now,
      });
      const widgets = [mail.widget, memory.widget];
      const frameDir = join(projectRoot, "out", "frames", "sponsor-followup");
      const artifacts = widgets.map((widget, index) => renderWidgetToFile(widget, join(frameDir, String(index + 1).padStart(2, "0") + "-" + widget.id + ".png"), {
        assetRoot: join(projectRoot, "fixtures", "images"),
      }));
      const packPath = join(projectRoot, "out", "sponsor-runtime", "followup-pack.json");
      const pack = {
        schema: "peripheral-sponsor-followup-pack-v1",
        generatedAt: now.toISOString(),
        workflow: "dinner-booking-post-approval",
        dispatches: { agentMail: mailResult, supermemory: memoryResult },
        events: [mail.event, memory.event],
        commands: [mail.command, memory.command],
        artifacts,
      };
      mkdirSync(dirname(packPath), { recursive: true });
      writeFileSync(packPath, JSON.stringify(pack, null, 2));
      return { ok: mailResult.ok && memoryResult.ok, mode: { agentMail: mailResult.mode, supermemory: memoryResult.mode }, pack, frameDir, packPath, artifacts };
    }
    case "stripe-hold": {
      const sessionId = String(cli.options["session-id"] || "stripe-card-hold");
      const amountCents = parseMoneyCents(cli.options["hold-amount"] || cli.options.amount || "25.00", "--hold-amount");
      const currency = typeof cli.options.currency === "string" ? cli.options.currency : "usd";
      const summary = String(cli.options.summary || cli.options.description || "Approval-gated Stripe card hold for a real-world agent task.");
      const result = await createStripePaymentIntent({
        sessionId,
        amountCents,
        currency,
        description: summary,
        customer: typeof cli.options.customer === "string" ? cli.options.customer : undefined,
        paymentMethod: typeof cli.options["payment-method"] === "string" ? cli.options["payment-method"] : undefined,
        now,
      }, {
        forceReal: Boolean(cli.options["real-stripe"]),
        env: process.env,
      });
      const normalized = normalizeSponsorEvent({
        sponsorId: "stripe",
        event: "payment_intent_requires_action",
        sessionId,
        title: "Approve Card Hold?",
        summary,
        amount: formatMoneyCents(amountCents, currency),
        risk: "medium",
        now,
      });
      return { ok: result.ok, mode: result.mode, stripe: result, event: normalized.event, widget: normalized.widget, command: normalized.command };
    }
    case "browser-task": {
      const sessionId = String(cli.options["session-id"] || "browser-use-task");
      const task = String(cli.options.task || cli.options.goal || cli.options.summary || cli.options.line || "Find the requested page evidence and stop before any sensitive submit.");
      const startUrl = typeof cli.options["start-url"] === "string"
        ? cli.options["start-url"]
        : typeof cli.options.url === "string" ? cli.options.url : undefined;
      const result = await runBrowserUseTask({
        sessionId,
        task,
        startUrl,
        model: typeof cli.options["browser-model"] === "string" ? cli.options["browser-model"] : undefined,
        profileId: typeof cli.options["profile-id"] === "string" ? cli.options["profile-id"] : undefined,
        workspaceId: typeof cli.options["workspace-id"] === "string" ? cli.options["workspace-id"] : undefined,
        maxCostUsd: typeof cli.options["max-cost-usd"] === "string" ? cli.options["max-cost-usd"] : undefined,
        proxyCountryCode: typeof cli.options["proxy-country"] === "string" ? cli.options["proxy-country"] : undefined,
        keepAlive: Boolean(cli.options["keep-alive"]),
        approvalIntent: typeof cli.options["approval-intent"] === "string"
          ? cli.options["approval-intent"]
          : typeof cli.options["approval-policy"] === "string" ? "Approval policy: " + cli.options["approval-policy"] : undefined,
        now,
      }, {
        forceReal: Boolean(cli.options["real-browser-use"]),
        env: process.env,
      });
      const normalizedEvents = result.events.map(normalizeBrowserUseEvent);
      const fallback = normalizeSponsorEvent({
        sponsorId: "browser_use",
        event: "browser_step",
        sessionId,
        title: "Browser Agent",
        summary: task,
        target: startUrl,
        risk: "low",
        now,
      });
      const primary = normalizedEvents.find((item) => item.command.decision_required) || normalizedEvents[0] || fallback;
      return {
        ok: result.ok,
        mode: result.mode,
        browserUse: result,
        event: primary.event,
        widget: primary.widget,
        command: primary.command,
        events: normalizedEvents.map((item) => item.event),
        widgets: normalizedEvents.map((item) => item.widget),
        commands: normalizedEvents.map((item) => item.command),
      };
    }
    case "sponge-context": {
      const sessionId = String(cli.options["session-id"] || "sponge-context");
      const text = String(cli.options["context-text"] || cli.options.summary || cli.options.line || "Summarize sensitive context for a wearer-safe glasses surface.");
      const result = await submitSpongeContext({
        sessionId,
        text,
        projectId: typeof cli.options["project-id"] === "string" ? cli.options["project-id"] : undefined,
        redactionMode: typeof cli.options.mode === "string" ? cli.options.mode as "context_digest" | "redaction_warning" | "safe_summary" : undefined,
        now,
      }, {
        forceReal: Boolean(cli.options["real-sponge"]),
        env: process.env,
      });
      const normalized = normalizeSponsorEvent({
        sponsorId: "sponge",
        event: "context_clustered",
        sessionId,
        title: "Context Digest",
        summary: text,
        risk: "low",
        now,
      });
      return { ok: result.ok, mode: result.mode, sponge: result, event: normalized.event, widget: normalized.widget, command: normalized.command };
    }
    case "gemini-route": {
      const sessionId = String(cli.options["session-id"] || "gemini-route");
      const prompt = String(cli.options.prompt || cli.options.summary || cli.options.line || "Choose the best glasses surface for this agent update.");
      const activeAgents = typeof cli.options["active-agents"] === "string" ? splitList(cli.options["active-agents"]) : ["codex_cli", "claude_code", "gemini_cli", "opencode"];
      const request = {
        sessionId,
        prompt,
        wearerInput: String(cli.options.line || prompt),
        focusedCardId: typeof cli.options["focused-card"] === "string" ? cli.options["focused-card"] : undefined,
        activeAgents,
        context: typeof cli.options.context === "string" ? cli.options.context : undefined,
        model: typeof cli.options["gemini-model"] === "string" ? cli.options["gemini-model"] : typeof cli.options.model === "string" ? cli.options.model : undefined,
        now,
      };
      const result = await routeWithGemini(request, {
        forceReal: Boolean(cli.options["real-gemini"]),
        env: process.env,
      });
      const normalized = normalizeGeminiRoute(result, request);
      return { ok: result.ok, mode: result.mode, gemini: result, event: normalized.event, widget: normalized.widget, command: normalized.command, decision: normalized.decision };
    }
    default:
      throw new Error("Unknown sponsor-runtime view. Use one of: adapters, request, dispatch, agentphone-call, agentmail-send, supermemory-save, followup-pack, stripe-hold, browser-task, sponge-context, gemini-route");
  }
}

function agentMailConfirmationInput(cli: ParsedCli, now: Date): AgentMailConfirmationRequest {
  return {
    sessionId: String(cli.options["session-id"] || "dinner-confirmation-email"),
    restaurantName: String(cli.options["restaurant-name"] || cli.options.target || process.env.PERIPHERAL_RESTAURANT_NAME || "Sato Table"),
    bookingTime: String(cli.options["booking-time"] || cli.options["preferred-window"] || process.env.PERIPHERAL_PREFERRED_WINDOW || "7:45"),
    partySize: Math.max(1, Number(cli.options["party-size"] || process.env.PERIPHERAL_PARTY_SIZE || 2)),
    bookingName: String(cli.options["booking-name"] || process.env.PERIPHERAL_BOOKING_NAME || process.env.PERIPHERAL_WEARER_NAME || "Wearer"),
    to: typeof cli.options["email-to"] === "string" ? cli.options["email-to"] : undefined,
    from: typeof cli.options["email-from"] === "string" ? cli.options["email-from"] : undefined,
    subject: typeof cli.options.title === "string" ? cli.options.title : undefined,
    text: typeof cli.options.body === "string" ? cli.options.body : typeof cli.options.summary === "string" ? cli.options.summary : undefined,
    now,
  };
}

function supermemoryPreferenceInput(cli: ParsedCli, now: Date): SupermemoryPreferenceRequest {
  return {
    sessionId: String(cli.options["memory-session-id"] || cli.options["session-id"] || "dinner-preference"),
    wearerName: String(cli.options["wearer-name"] || cli.options["booking-name"] || process.env.PERIPHERAL_WEARER_NAME || process.env.PERIPHERAL_BOOKING_NAME || "Wearer"),
    preference: String(cli.options.preference || cli.options["context-text"] || cli.options.summary || cli.options.body || "Saved preference: prefers 7-8pm dinner slots."),
    restaurantName: typeof cli.options["restaurant-name"] === "string" ? cli.options["restaurant-name"] : typeof cli.options.target === "string" ? cli.options.target : process.env.PERIPHERAL_RESTAURANT_NAME,
    bookingTime: String(cli.options["booking-time"] || cli.options["preferred-window"] || process.env.PERIPHERAL_PREFERRED_WINDOW || "7:45"),
    now,
  };
}

function supermemoryRuntimeEnv(cli: ParsedCli): Record<string, string | undefined> {
  return {
    ...process.env,
    ...(typeof cli.options["memory-container"] === "string" ? { SUPERMEMORY_CONTAINER: cli.options["memory-container"] } : {}),
  };
}

function sponsorRuntimeInput(cli: ParsedCli, now: Date): SponsorEventInput {
  const sponsorId = String(cli.options.sponsor || cli.positionals[1] || "stripe");
  const event = String(cli.options.event || cli.positionals[2] || "payment_intent_requires_action");
  return {
    sponsorId: sponsorId as SponsorEventInput["sponsorId"],
    event: event as SponsorEventInput["event"],
    sessionId: String(cli.options["session-id"] || cli.positionals[3] || "runtime-check"),
    title: typeof cli.options.title === "string" ? cli.options.title : undefined,
    summary: String(cli.options.summary || cli.options.line || "Runtime sponsor event routed through the broker."),
    risk: typeof cli.options.risk === "string" ? cli.options.risk as SponsorEventInput["risk"] : undefined,
    amount: typeof cli.options.amount === "string" ? cli.options.amount : undefined,
    target: typeof cli.options.target === "string" ? cli.options.target : undefined,
    code: typeof cli.options.code === "string" ? cli.options.code : undefined,
    now,
  };
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function sponsorRuntimeForceReal(cli: ParsedCli, sponsorId: SponsorEventInput["sponsorId"]): boolean {
  const sponsorFlag = "real-" + sponsorId.replace(/_/g, "-");
  return Boolean(cli.options.real || cli.options["real-sponsor"] || cli.options[sponsorFlag]);
}

function redactSponsorRuntimeRequest(request: SponsorRuntimeRequest): SponsorRuntimeRequest {
  return {
    ...request,
    headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [
      key,
      key.toLowerCase() === "authorization" ? "Bearer [configured]" : value,
    ])),
  };
}

function runtimeOptions(cli: ParsedCli, projectRoot: string, repoRoot: string, logPath: string): HudRuntimeOptions {
  const realDisplay = Boolean(cli.options.real);
  const inputMode: HudInputMode = cli.options.mic === "mac" || cli.options["mac-mic"] ? "mac_mic" : "text";
  const hermesMode: HermesMode = cli.options["real-hermes"] ? "real" : cli.options["local-hermes"] ? "local" : "auto";
  const asrProvider = normalizeAsrProvider(cli.options["asr-provider"]);
  return {
    projectRoot,
    repoRoot,
    displayMode: realDisplay ? "real" : "local",
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
    hermesTmuxSession: typeof cli.options["hermes-tmux-session"] === "string" ? cli.options["hermes-tmux-session"] : undefined,
    hermesModel: typeof cli.options["hermes-model"] === "string" ? cli.options["hermes-model"] : undefined,
    hermesReasoningEffort: typeof cli.options["hermes-reasoning"] === "string" ? cli.options["hermes-reasoning"] : undefined,
    hermesFastMode: cli.options["no-hermes-fast"] ? false : undefined,
    openHermesTerminal: Boolean(cli.options["open-hermes-terminal"]),
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
  const widget: PeripheralWidget = {
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
  if (name !== "dinner-booking") {
    throw new Error("demo requires dinner-booking.");
  }
  return commandDinnerBookingDemo(cli, projectRoot, driverOptions);
}

async function commandDinnerBookingDemo(cli: ParsedCli, projectRoot: string, driverOptions: DriverOptions): Promise<unknown> {
  const now = new Date();
  const fixturePath = join(projectRoot, "fixtures", "dinner_booking_walkthrough.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
  const restaurant = asRecord(fixture.restaurant);
  const approval = asRecord(fixture.approval);
  const requestText = typeof fixture.request === "string"
    ? fixture.request
    : stringValue(asRecord(fixture.request).text) || "Book dinner for two tonight near Mission, under Karim.";
  const dinnerRequest: AgentPhoneDinnerRequest = {
    restaurantName: String(cli.options["restaurant-name"] || stringValue(restaurant.name) || "Sato Table"),
    restaurantPhoneNumber: String(cli.options["restaurant-phone"] || stringValue(restaurant.phone) || ""),
    partySize: Math.max(1, Number(cli.options["party-size"] || numberValue(restaurant.party_size) || 2)),
    neighborhood: String(cli.options.neighborhood || stringValue(restaurant.neighborhood) || "Mission"),
    bookingName: String(cli.options["booking-name"] || stringValue(approval.confirmation_name) || "Karim"),
    preferredWindow: String(cli.options["preferred-window"] || stringValue(approval.booking_time) || "7:45"),
    prompt: requestText,
    now,
  };
  const frameDir = join(projectRoot, "out", "frames", "dinner-booking");
  const demoDir = join(projectRoot, "out", "demo");
  const logPath = typeof cli.options.log === "string" ? resolve(cli.options.log) : join(projectRoot, "out", "logs", "dinner-booking.jsonl");
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  mkdirSync(demoDir, { recursive: true });
  if (typeof cli.options.log !== "string") {
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, "", "utf8");
  }
  const displayOptions: DriverOptions = {
    ...driverOptions,
    local: driverOptions.local || Boolean(cli.options.local || cli.options["local-display"] || !cli.options.real),
    logPath,
  };
  const sessionId = "dinner-booking";
  const timeline: Array<Record<string, unknown>> = [];
  const artifacts: Array<Record<string, unknown>> = [];

  await recordDinnerStep({
    step: "user_request",
    surface: "tiny_hud",
    text: requestText,
    widget: widget("dinner-user-request", "generic_card", "Dinner Request", {
      status: "USER REQUEST",
      body: requestText,
      bullets: ["AgentPhone call", "AgentMail confirmation", "Supermemory preference"],
      source: "Peripheral",
    }),
  }, timeline, artifacts, frameDir, displayOptions);

  const callSession = await runAgentPhoneDinnerBooking(dinnerRequest, {
    forceReal: Boolean(cli.options["real-agentphone"]),
  });
  for (const item of callSession.events.map((event) => normalizeAgentPhoneEvent(event))) {
    await recordDinnerStep({
      step: dinnerStepName(item.event.id, item.event.kind),
      surface: item.command.surface,
      text: String(item.event.summary || item.event.title || "AgentPhone call update."),
      event: item.event,
      command: item.command,
      widget: item.widget,
    }, timeline, artifacts, frameDir, displayOptions);
  }

  const approvalEventId = String(approval.event_id || "booking-approval-1");
  if (cli.options["wait-for-approval"] && !cli.options["auto-approve"]) {
    timeline.push({
      step: "approval_pause",
      eventId: approvalEventId,
      status: "WAITING_FOR_APPROVAL",
      nextCommand: "npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime decide --event " + approvalEventId + " --choice approve",
      createdAt: now.toISOString(),
    });
    await appendJsonl(logPath, { event: "dinner-booking.waiting_for_approval", eventId: approvalEventId });
    const result = writeDinnerTimeline(projectRoot, timeline, artifacts, frameDir, logPath, "WAITING_FOR_APPROVAL");
    return {
      ok: true,
      demo: "dinner-booking",
      status: "WAITING_FOR_APPROVAL",
      approvalCommand: "npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime decide --event " + approvalEventId + " --choice approve",
      ...result,
    };
  }

  const decision = dinnerApprovalDecision(projectRoot, cli, now);
  timeline.push({
    step: "approval_decision",
    eventId: decision.event_id,
    choice: decision.choice,
    source: decision.source,
    status: decision.choice === "approve" ? "APPROVED" : "WAITING_FOR_APPROVAL",
    createdAt: now.toISOString(),
  });
  await appendJsonl(logPath, { event: "dinner-booking.approval_decision", decision });

  if (decision.choice !== "approve") {
    const result = writeDinnerTimeline(projectRoot, timeline, artifacts, frameDir, logPath, "WAITING_FOR_APPROVAL");
    return {
      ok: true,
      demo: "dinner-booking",
      status: "WAITING_FOR_APPROVAL",
      approvalCommand: "npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime decide --event " + decision.event_id + " --choice approve",
      ...result,
    };
  }

  const mail = normalizeSponsorEvent({
    sponsorId: "agentmail",
    event: "reply_sent",
    sessionId: "dinner-confirmation-email",
    title: "Confirmation Sent",
    summary: "Confirmation email sent for " + dinnerRequest.preferredWindow + " dinner at " + dinnerRequest.restaurantName + ".",
    risk: "low",
    now,
  });
  const mailDispatch = await sendAgentMailConfirmation({
    sessionId: "dinner-confirmation-email",
    restaurantName: dinnerRequest.restaurantName,
    bookingTime: dinnerRequest.preferredWindow,
    partySize: dinnerRequest.partySize,
    bookingName: dinnerRequest.bookingName,
    to: typeof cli.options["email-to"] === "string" ? cli.options["email-to"] : undefined,
    from: typeof cli.options["email-from"] === "string" ? cli.options["email-from"] : undefined,
    now,
  }, {
    forceReal: Boolean(cli.options["real-agentmail"]),
    env: process.env,
  });
  await recordDinnerStep({
    step: "agentmail_confirmation",
    surface: mail.command.surface,
    text: String(mail.event.summary || "Confirmation email sent."),
    event: mail.event,
    command: mail.command,
    dispatch: mailDispatch,
    widget: mail.widget,
  }, timeline, artifacts, frameDir, displayOptions);

  const memory = normalizeSponsorEvent({
    sponsorId: "supermemory",
    event: "memory_saved",
    sessionId: "dinner-preference",
    title: "Preference Saved",
    summary: "Saved preference: prefers 7-8pm dinner slots.",
    risk: "low",
    now,
  });
  const memoryDispatch = await saveDinnerPreference({
    sessionId: "dinner-preference",
    wearerName: dinnerRequest.bookingName,
    preference: "Saved preference: prefers 7-8pm dinner slots.",
    restaurantName: dinnerRequest.restaurantName,
    bookingTime: dinnerRequest.preferredWindow,
    now,
  }, {
    forceReal: Boolean(cli.options["real-supermemory"]),
    env: {
      ...process.env,
      ...(typeof cli.options["memory-container"] === "string" ? { SUPERMEMORY_CONTAINER: cli.options["memory-container"] } : {}),
    },
  });
  await recordDinnerStep({
    step: "supermemory_saved",
    surface: "tiny_hud",
    text: String(memory.event.summary || "Dinner preference saved."),
    event: memory.event,
    command: memory.command,
    dispatch: memoryDispatch,
    widget: memory.widget,
  }, timeline, artifacts, frameDir, displayOptions);

  const result = writeDinnerTimeline(projectRoot, timeline, artifacts, frameDir, logPath, "COMPLETED");
  return {
    ok: true,
    demo: "dinner-booking",
    status: "COMPLETED",
    agentPhonePath: callSession.mode,
    agentPhoneEndpoint: callSession.endpoint || undefined,
    agentPhoneRunState: callSession.mode === "real" ? "dispatched" : "phone_gateway",
    agentMailRunState: mailDispatch.mode,
    supermemoryRunState: memoryDispatch.mode,
    realAgentPhoneRequested: Boolean(cli.options["real-agentphone"]),
    realAgentMailRequested: Boolean(cli.options["real-agentmail"]),
    realSupermemoryRequested: Boolean(cli.options["real-supermemory"]),
    summary: "Dinner booked for " + dinnerRequest.preferredWindow + ". Confirmation sent. Preference saved.",
    ...result,
  };
}

type DinnerStep = {
  step: string;
  surface: SurfaceKind;
  text: string;
  widget: PeripheralWidget;
  state?: string;
  event?: unknown;
  command?: unknown;
  dispatch?: unknown;
};

type DinnerApprovalDecision = UserDecision & {
  choice: UserDecision["decision"];
};

async function recordDinnerStep(
  step: DinnerStep,
  timeline: Array<Record<string, unknown>>,
  artifacts: Array<Record<string, unknown>>,
  frameDir: string,
  driverOptions: DriverOptions,
): Promise<void> {
  const index = artifacts.length + 1;
  const artifact = renderWidgetToFile(step.widget, join(frameDir, String(index).padStart(2, "0") + "-" + slug(step.step) + ".png"), {
    assetRoot: join(driverOptions.projectRoot, "fixtures", "images"),
  });
  const push = await pushArtifact(artifact, driverOptions);
  const artifactSummary = {
    pngPath: artifact.pngPath,
    sidecarPath: artifact.sidecarPath,
    width: artifact.width,
    height: artifact.height,
    litPixels: artifact.stats.litPixels,
    rawBytes: artifact.stats.rawBytes,
  };
  const entry = {
    index,
    step: step.step,
    surface: step.surface,
    text: step.text,
    state: step.state || (step.step === "approval_required" ? "WAITING_FOR_APPROVAL" : undefined),
    widgetId: step.widget.id,
    widgetType: step.widget.type,
    agentEvent: step.event,
    command: step.command,
    dispatch: step.dispatch,
    artifact: artifactSummary,
    push,
  };
  timeline.push(entry);
  artifacts.push({ step: step.step, artifact: artifactSummary, push });
  await appendJsonl(driverOptions.logPath || defaultLogPath(driverOptions.projectRoot, "dinner-booking"), {
    event: "dinner-booking.step",
    ...entry,
  });
}

function dinnerStepName(id: string, kind: string): string {
  const normalized = id.replace(/_/g, "-");
  if (kind === "approval_required" || normalized.includes("time-offered") || normalized.includes("takeover") || normalized.includes("approval")) return "approval_required";
  if (normalized.includes("call-started")) return "agentphone_call_started";
  if (normalized.includes("transcript") || normalized.includes("time")) return "agentphone_transcript";
  if (normalized.includes("connected")) return "agentphone_transcript";
  return "agentphone_" + slug(id || kind || "event").replace(/-/g, "_");
}

function dinnerApprovalDecision(projectRoot: string, cli: ParsedCli, now: Date): DinnerApprovalDecision {
  const explicit = typeof cli.options.choice === "string" || Boolean(cli.options["auto-approve"]);
  const decision = explicit ? buildApprovalDecision(cli, now) : readApprovalDecision(projectRoot, "booking-approval-1") || buildApprovalDecision(cli, now);
  writeApprovalDecision(projectRoot, decision);
  return { ...decision, choice: decision.decision };
}

function writeApprovalDecision(projectRoot: string, decision: UserDecision): string {
  const approvalPath = join(projectRoot, "out", "demo", "dinner-booking-approval.json");
  mkdirSync(dirname(approvalPath), { recursive: true });
  writeFileSync(approvalPath, JSON.stringify(decision, null, 2) + "\n", "utf8");
  return approvalPath;
}

function readApprovalDecision(projectRoot: string, eventId: string): UserDecision | null {
  const approvalPath = join(projectRoot, "out", "demo", "dinner-booking-approval.json");
  if (!existsSync(approvalPath)) return null;
  try {
    const decision = JSON.parse(readFileSync(approvalPath, "utf8")) as UserDecision;
    return decision.event_id === eventId ? decision : null;
  } catch {
    return null;
  }
}

function writeDinnerTimeline(
  projectRoot: string,
  timeline: Array<Record<string, unknown>>,
  artifacts: Array<Record<string, unknown>>,
  frameDir: string,
  logPath: string,
  statusValue: "COMPLETED" | "WAITING_FOR_APPROVAL",
): Record<string, unknown> {
  const timelinePath = join(projectRoot, "out", "demo", "dinner-booking-timeline.json");
  const summaryPath = join(projectRoot, "out", "demo", "dinner-booking-summary.md");
  const payload = {
    schema: "peripheral-dinner-booking-timeline-v1",
    generatedAt: new Date().toISOString(),
    demo: "dinner-booking",
    status: statusValue,
    approvalEventId: "booking-approval-1",
    artifacts: {
      frames: frameDir,
      log: logPath,
      summary: summaryPath,
    },
    steps: timeline,
    renderedArtifacts: artifacts,
    nextCommand: statusValue === "WAITING_FOR_APPROVAL"
      ? "npm --prefix peripheral-hud-runtime run peripheralctl -- phone-runtime decide --event booking-approval-1 --choice approve"
      : undefined,
  };
  mkdirSync(dirname(timelinePath), { recursive: true });
  writeFileSync(timelinePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  writeFileSync(summaryPath, [
    "# Dinner Booking Timeline",
    "",
    "Status: " + statusValue,
    "Frames: " + frameDir,
    "Timeline: " + timelinePath,
    "Log: " + logPath,
    "",
    "Steps:",
    ...timeline.map((step) => "- " + String(step.step) + ": " + String(step.text || step.status || "")),
    "",
  ].join("\n"), "utf8");
  return {
    timelinePath,
    summaryPath,
    frameDir,
    frames: frameDir,
    logPath,
    steps: timeline.length,
    artifacts: artifacts.length,
    timeline,
    renderedArtifacts: artifacts,
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "step";
}

async function commandWalkthrough(cli: ParsedCli, projectRoot: string, driverOptions: DriverOptions): Promise<unknown> {
  const name = cli.positionals[0];
  if (!name) throw new Error("walkthrough requires one of: live-call, blackjack, conference, agent, integrations");
  const cadenceMs = Math.max(250, Number(cli.options["cadence-ms"] || 1400));
  const flow = walkthroughFlow(name);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const frameDir = join(projectRoot, "out", "frames", `walkthrough-${name}-${stamp}`);
  const steps = [];
  for (const [index, widget] of flow.entries()) {
    const artifact = renderWidgetToFile(widget, join(frameDir, `${String(index + 1).padStart(2, "0")}-${widget.type}.png`), {
      assetRoot: join(projectRoot, "fixtures", "images"),
    });
    const push = await pushArtifact(artifact, driverOptions);
    const step = { index, widgetId: widget.id, widgetType: widget.type, artifact, push, intendedCadenceMs: cadenceMs };
    steps.push(step);
    await appendJsonl(driverOptions.logPath || defaultLogPath(projectRoot), { event: "walkthrough.step", walkthrough: name, ...step });
    if (index < flow.length - 1) {
      await delay(driverOptions.local || driverOptions.dryRun ? Math.min(80, cadenceMs) : cadenceMs);
    }
  }
  return { ok: true, walkthrough: name, frames: frameDir, logPath: driverOptions.logPath, steps: steps.length };
}

async function commandMeasureLatency(projectRoot: string, driverOptions: DriverOptions, realHardwareOk: boolean): Promise<unknown> {
  if (!driverOptions.local && !driverOptions.dryRun && !realHardwareOk) {
    throw new Error("measure-latency in live transport mode requires --real-hardware-ok after explicit live-glasses permission.");
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
    const push = driverOptions.local || driverOptions.dryRun
      ? await localLatencyPush(projectRoot, driverOptions, item.case, built)
      : await pushArtifact(artifact, driverOptions);
    const pushMs = roundMs(performance.now() - pushStart);
    rows.push({
      case: item.case,
      route: item.route,
      renderMs,
      encodeMs,
      pushMs,
      pushMode: driverOptions.local || driverOptions.dryRun ? "local" : "real",
      compressedBytes: built.compressed.length,
      payloadBytes: built.payload.length,
      frames: built.frames.length,
      rawBytes: Buffer.from(artifact.pixelsBase64, "base64").length,
      push,
    });
    if (!driverOptions.local && !driverOptions.dryRun) await delay(1400);
  }
  const docsPath = join(projectRoot, "docs", "LATENCY.md");
  const maxEncode = Math.max(...rows.map((row) => Number(row.encodeMs)));
  const maxFrames = Math.max(...rows.map((row) => Number(row.frames)));
  const interpretation = [
    `Local render plus encode is comfortably below one subtitle cadence on this Mac; max encode was ${maxEncode} ms and max full-panel fragment count was ${maxFrames}.`,
    "Live transport and wearer-visible refresh remain behind the explicit bridge permission gate while the glasses are in use.",
    "Default v0 cadence remains 1400 ms for live-call chunks, with 700 ms available after bridge measurements confirm stable refresh.",
  ].join(" ");
  await writeLatencyMarkdown(docsPath, rows, interpretation);
  return { ok: true, local: Boolean(driverOptions.local || driverOptions.dryRun), docsPath, rows, interpretation, logPath: driverOptions.logPath };
}

async function localLatencyPush(projectRoot: string, driverOptions: DriverOptions, caseName: string, built: ReturnType<typeof buildDisplayImageFrames>): Promise<Record<string, unknown>> {
  await appendJsonl(driverOptions.logPath || defaultLogPath(projectRoot), {
    event: "latency.local-push",
    case: caseName,
    frames: built.frames.length,
    compressedBytes: built.compressed.length,
  });
  return { ok: true, local: true, frames: built.frames.length, compressedBytes: built.compressed.length };
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
    local: Boolean(driverOptions.local),
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
        reason: "Read-only capture is waiting for the sidecar readiness signal.",
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
      endpoints: pickStringFields(configBody, ["framebufferUrl", "realMirrorUrl", "mirrorRealUrl", "mirrorWalkthroughUrl"]),
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
      macBridgeRunning ? "Mac bridge is running for read-only display capture." : "Mac bridge endpoint is idle; capture starts when the sidecar is available.",
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
      reason: "Sidecar framebuffer diagnostics are waiting for the readiness signal.",
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
      "demo dinner-booking",
      "demo dinner-booking --real-agentphone --real-agentmail --real-supermemory --local-display",
      "review-bundle",
      "hud --local-display --text",
      "hud --local-display --mic mac",
      "hud --local-display --mic mac --asr-provider openai-realtime",
      "hud --real --text",
      "hud --real --mic mac",
      "hud --real --mic mac --real-hermes",
      "hud --real --mic mac --hermes-cli --real-hermes --hermes-tmux-session peripheral-hud-hermes --open-hermes-terminal",
      "hud --real --mic mac --asr-provider openai-realtime --real-hermes",
      "asr-replay --local-display --local-hermes",
      "asr-replay --real --local-hermes --framebuffer-check",
      "agents --local",
      "agents --real",
      "integrations summary",
      "integrations sponsors",
      "integrations agent-clis",
      "integrations connected-state",
      "integrations hardware-profile",
      "integrations support",
      "integrations live-adapters",
      "integrations mcp-manifest",
      "integrations broker-timeline",
      "integrations sponsor-events",
      "integrations phone-runtime",
      "integrations dossier",
      "integrations widgets",
      "agent-bridge dossier",
      "agent-bridge adapters",
      "agent-bridge launch-specs",
      "agent-bridge runtime-plan",
      "agent-bridge launch",
      "agent-bridge transcript",
      "agent-bridge session-pack",
      "agent-bridge event",
      "agent-bridge route",
      "agent-bridge session",
      "agent-bridge widget",
      "phone-runtime snapshot",
      "phone-runtime lease",
      "phone-runtime route",
      "phone-runtime agent-mode-lease",
      "phone-runtime ingest --sponsor agentphone --event call_connected",
      "sponsor-workflows dossier",
      "sponsor-workflows list",
      "sponsor-workflows workflow",
      "sponsor-workflows widgets",
      "sponsor-runtime adapters",
      "sponsor-runtime request",
      "sponsor-runtime dispatch",
      "sponsor-runtime agentphone-call --restaurant-phone <number> --prompt <text>",
      "sponsor-runtime agentmail-send --restaurant-name <name> --preferred-window <time>",
      "sponsor-runtime supermemory-save --preference <text>",
      "sponsor-runtime followup-pack --restaurant-name <name> --preferred-window <time>",
      "sponsor-runtime stripe-hold --hold-amount 25.00 --currency usd",
      "sponsor-runtime browser-task --task <text> --start-url <url>",
      "sponsor-runtime browser-task --goal \"Check restaurant availability\"",
      "sponsor-runtime sponge-context --context-text \"Summarize this customer context\"",
      "sponsor-runtime gemini-route --prompt \"Route this agent update\"",
      "sponsor-runtime gemini-route --line \"hey codex show status\"",
      "hudctl show-json",
      "hudctl show-card",
      "hudctl clear",
      "hudctl status",
      "hudctl emit-agent-status",
      "live-check",
      "walkthrough live-call",
      "walkthrough blackjack",
      "walkthrough conference",
      "walkthrough agent",
      "walkthrough integrations",
      "diagnostics",
    ],
    display: PERIPHERAL_DISPLAY,
    realPush: "HUD runtime uses the existing macos_corebluetooth/peripheral-mac-pusher stdin raw-write bridge when --real is explicit. Legacy image commands still require --real-hardware-ok.",
  };
}

function loadAsrReplayScript(cli: ParsedCli, projectRoot: string): Record<string, unknown> & { steps: ScriptedTranscriptStep[] } {
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

  const steps = parseAsrReplayScript(raw);
  return {
    schema: "peripheral-asr-replay-script-v1",
    source,
    path: scriptPath,
    steps,
    stepCount: steps.length,
    sha256: sha256(JSON.stringify(steps)),
  };
}

function parseAsrReplayScript(raw: string): ScriptedTranscriptStep[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("ASR replay script is empty.");
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const items = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.steps) ? parsed.steps : null;
    if (!items) {
      throw new Error("ASR replay JSON script must be an array, or an object with a steps array.");
    }
    return normalizeAsrSteps(items);
  }
  return normalizeAsrSteps(parsePlainAsrReplaySteps(trimmed));
}

function parsePlainAsrReplaySteps(value: string): ScriptedTranscriptStep[] {
  const steps: ScriptedTranscriptStep[] = [];
  for (const rawLine of value.split(/\r?\n|\s*\|\s*/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const wait = line.match(/^@?wait\s+(\d+)(?:\s*ms)?$/i);
    if (wait) {
      if (!steps.length) throw new Error("ASR replay @wait must follow a transcript line.");
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
        throw new Error("ASR replay script waitMs at index " + index + " must be a number.");
      }
      return waitMs === undefined ? { text: item.text } : { text: item.text, waitMs };
    }
    throw new Error("ASR replay script item " + index + " must be a string or { text, waitMs }.");
  }).filter((step) => step.text.trim().length > 0);
  if (!steps.length) {
    throw new Error("ASR replay script must contain at least one transcript line.");
  }
  return steps;
}

function walkthroughFlow(name: string): PeripheralWidget[] {
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
    case "integrations":
      return [
        buildAgentCockpitWidget(),
        buildSponsorMatrixWidget(),
        buildAgentCliMatrixWidget(),
      ].map(assertWidget);
    default:
      throw new Error("Unknown walkthrough. Use one of: live-call, blackjack, conference, agent, integrations");
  }
}

function widget(id: string, type: PeripheralWidget["type"], title: string, rest: Partial<PeripheralWidget>): PeripheralWidget {
  return assertWidget({ id, type, title, created_at: new Date().toISOString(), ...rest });
}

function parseCli(argv: string[]): ParsedCli {
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (flagExpectsValue(key, positionals)) {
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

function flagExpectsValue(key: string, positionals: string[]): boolean {
  return VALUE_FLAGS.has(key);
}

function printHelp(): void {
  console.log(`peripheralctl - semantic widgets to Peripheral HUD frames

Usage:
  peripheralctl render-json <ui.json> --out <frame.png>
  peripheralctl push-json <ui.json> [--local]
  peripheralctl show-image <frame.png> [--local]
  peripheralctl clear [--local]
  peripheralctl status [--local]
  peripheralctl measure-latency [--local]
  peripheralctl demo dinner-booking [--local] [--json]
  peripheralctl review-bundle --json
  peripheralctl hud --local-display --text
  peripheralctl hud --local-display --text --hermes-cli
  peripheralctl hud --local-display --mic mac
  peripheralctl hud --real --mic mac --hermes-cli --real-hermes
  peripheralctl hud --real --text
  peripheralctl hud --real --mic mac
  peripheralctl asr-replay --local-display --local-hermes
  peripheralctl asr-replay --real --local-hermes [--framebuffer-check]
  peripheralctl agents --local
  peripheralctl agents --real
  peripheralctl integrations summary
  peripheralctl integrations sponsors
  peripheralctl integrations agent-clis
  peripheralctl integrations connected-state
  peripheralctl integrations hardware-profile
  peripheralctl integrations support
  peripheralctl integrations live-adapters
  peripheralctl integrations mcp-manifest
  peripheralctl integrations broker-timeline
  peripheralctl integrations sponsor-events
  peripheralctl integrations phone-runtime
  peripheralctl integrations dossier
  peripheralctl integrations widgets
  peripheralctl agent-bridge dossier
  peripheralctl agent-bridge adapters
  peripheralctl agent-bridge launch-specs
  peripheralctl agent-bridge runtime-plan [--agent codex_cli] [--session-id codex-auth]
  peripheralctl agent-bridge launch --agent codex_cli --task "Summarize this repo in one sentence" --execute --json
  peripheralctl agent-bridge transcript
  peripheralctl agent-bridge session-pack [--session-prefix reviewer]
  peripheralctl agent-bridge event --agent codex_cli --session-id codex-auth --line "Codex needs approval to run npm test"
  peripheralctl agent-bridge route --agent codex_cli --session-id codex-auth --line "Codex needs approval to run npm test"
  peripheralctl agent-bridge session --agent codex_cli --session-id codex-auth --line "Codex needs approval to run npm test"
  peripheralctl agent-bridge widget --agent claude_code --line "Claude Code is 40% complete"
  peripheralctl phone-runtime snapshot
  peripheralctl phone-runtime lease --agent codex_cli --line "Codex needs approval to run npm test"
  peripheralctl phone-runtime route --line "hey codex show status"
  peripheralctl phone-runtime agent-mode-lease --line "User looked up into Agent Mode"
  peripheralctl phone-runtime ingest --sponsor agentphone --event call_connected --session-id call-check --summary "Call connected"
  peripheralctl sponsor-workflows dossier
  peripheralctl sponsor-workflows list
  peripheralctl sponsor-workflows workflow stripe
  peripheralctl sponsor-workflows widgets
  peripheralctl sponsor-runtime adapters
  peripheralctl sponsor-runtime request --sponsor stripe --event payment_intent_requires_action --session-id stripe-check --summary "Approve card hold"
  peripheralctl sponsor-runtime dispatch --sponsor agentphone --event call_connected --session-id call-check --summary "Call connected"
  peripheralctl sponsor-runtime agentphone-call --restaurant-phone +14155550137 --prompt "Book dinner for two and pause before confirming"
  peripheralctl sponsor-runtime agentmail-send --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim
  peripheralctl sponsor-runtime supermemory-save --preference "Prefers 7-8pm dinner slots" --memory-container dinner-preferences
  peripheralctl sponsor-runtime followup-pack --restaurant-name "Sato Table" --preferred-window 7:45 --booking-name Karim
  peripheralctl sponsor-runtime stripe-hold --hold-amount 25.00 --currency usd --summary "Refundable dinner hold"
  peripheralctl sponsor-runtime browser-task --task "Check reservation availability and stop before submit" --start-url https://example.com
  peripheralctl sponsor-runtime browser-task --goal "Check restaurant availability" --url https://example.com
  peripheralctl sponsor-runtime sponge-context --context-text "Summarize customer context for glasses"
  peripheralctl sponsor-runtime gemini-route --prompt "Route this agent update to a glasses surface"
  peripheralctl sponsor-runtime gemini-route --line "hey codex show status"
  peripheralctl demo dinner-booking --local
  peripheralctl demo dinner-booking --real-agentphone --real-agentmail --real-supermemory --local-display
  peripheralctl phone-runtime decide --event booking-approval-1 --choice approve
  peripheralctl walkthrough live-call [--local]
  peripheralctl walkthrough blackjack [--local]
  peripheralctl walkthrough conference [--local]
  peripheralctl walkthrough agent [--local]
  peripheralctl walkthrough integrations [--local]
  peripheralctl diagnostics [--local] [--sidecar-url http://127.0.0.1:8791]
  peripheralctl live-check [--attempt-connect --real-hardware-ok] [--capture] [--local]

Global options:
  --local                  Local render/push transport; live-check still talks to the sidecar.
  --dry-run               Same safety posture as runtime display mode, labelled dry-run.
  --json                  Print machine-readable JSON.
  --log <path>            JSONL log path.
  --repo-root <path>      Repo root containing macos_corebluetooth.
  --sidecar-url <url>     Local sidecar URL for read-only display diagnostics.
  --script <path>         For asr-replay: newline text with @wait lines or JSON transcript steps.
  --asr-text <text>       For asr-replay: one line or pipe-separated transcript lines.
  --step-delay-ms <ms>    For asr-replay: delay after each transcript line.
  --attempt-connect       For live-check only: call the sidecar pair/connect route; requires --real-hardware-ok.
  --capture               For live-check only: run read-only capture when ready.
  --page-start <n>        For live-check capture; default 184.
  --page-count <n>        For live-check capture; default 3.
  --real-hardware-ok      Required for legacy real display commands without --real.
  --agent <id>            For agent-bridge/phone-runtime routes: codex_cli, claude_code, gemini_cli, opencode, openclaw, or pi.
  --sponsor <id>          For sponsor-runtime: agentphone, stripe, supermemory, agentmail, browser_use, sponge, or gemini.
  --event <name>          For sponsor-runtime: sponsor event name to normalize or dispatch.
  --session-id <id>       Stable session id for the normalized event.
  --session-prefix <id>   For agent-bridge session-pack: shared prefix for six agent sessions.
  --line <text>           Bounded CLI transcript, input line, or fallback sponsor summary to normalize.
  --payload-json <json>   For phone-runtime ingest: inbound sponsor or agent event payload.
  --payload-file <path>   For phone-runtime ingest: JSON file containing an inbound payload.
  --execute               For agent-bridge launch: start the local CLI process instead of returning the phone-gateway route.
  --process-command <bin> For agent-bridge launch: run a specific executable while preserving agent routing.
  --process-args-json <a> For agent-bridge launch: JSON string array of process args.
  --timeout-ms <ms>       For agent-bridge launch: process timeout, default 15000.
  --summary <text>        For sponsor-runtime: event summary sent through the broker payload.
  --restaurant-phone <n>  For sponsor-runtime agentphone-call or dinner-booking: venue phone number.
  --restaurant-name <n>   For sponsor-runtime agentphone-call or dinner-booking: venue name.
  --preferred-window <t>  For sponsor-runtime agentphone-call or dinner-booking: preferred booking time.
  --booking-time <t>      For sponsor-runtime AgentMail/Supermemory: confirmed booking time.
  --wearer-name <name>    For sponsor-runtime Supermemory: wearer identity label.
  --preference <text>     For sponsor-runtime Supermemory: preference content to store.
  --hold-amount <amount>  For sponsor-runtime stripe-hold: card-hold amount, e.g. 25.00 or cents.
  --currency <code>       For sponsor-runtime stripe-hold: currency code, default usd.
  --customer <id>         For sponsor-runtime stripe-hold: optional Stripe customer id.
  --payment-method <id>   For sponsor-runtime stripe-hold: optional Stripe payment method id.
  --task <text>           For agent-bridge launch or sponsor-runtime browser-task.
  --start-url <url>       For sponsor-runtime browser-task: initial URL context.
  --browser-model <id>    For sponsor-runtime browser-task: Browser Use model, default gemini-3-flash.
  --profile-id <id>       For sponsor-runtime browser-task: Browser Use profile id.
  --workspace-id <id>     For sponsor-runtime browser-task: Browser Use workspace id.
  --max-cost-usd <value>  For sponsor-runtime browser-task: Browser Use spend ceiling.
  --proxy-country <code>  For sponsor-runtime browser-task: proxy country code, default us.
  --approval-intent <txt> For sponsor-runtime browser-task: action that must pause on glasses.
  --goal <text>           For sponsor-runtime browser-task: browser agent task goal.
  --url <url>             For sponsor-runtime browser-task: starting URL.
  --context-text <text>   For sponsor-runtime sponge-context: context text.
  --prompt <text>         For sponsor-runtime gemini-route: broker routing prompt.
  --context <text>        For sponsor-runtime gemini-route: extra routing context.
  --model <name>          For sponsor-runtime gemini-route: Gemini model name.
  --gemini-model <name>   For sponsor-runtime gemini-route: Gemini model alias.
  --focused-card <id>     For sponsor-runtime gemini-route: focused approval/card id.
  --active-agents <list>  For sponsor-runtime gemini-route: comma-separated agent ids.
  --email-to <addr>       For dinner-booking or sponsor-runtime agentmail-send: override AgentMail recipient.
  --email-from <addr>     For dinner-booking or sponsor-runtime agentmail-send: override AgentMail sender.
  --memory-container <id> For dinner-booking or sponsor-runtime supermemory-save: override Supermemory container.

HUD runtime options:
  --local-display          Use the runtime display driver without touching live display transport.
  --real                  Use the real display driver. Ask before using live.
  --text                  Read typed commands from stdin.
  --mic mac               Start Mac mic transcript source. Uses --stt-cmd, PERIPHERAL_HUD_STT_CMD, OpenAI Realtime when configured, or the bundled macOS Speech helper.
  --asr-provider <mode>   auto, openai-realtime, or macos-speech. Default auto.
  --stt-cmd <cmd>         Override the line-based STT command for --mic mac.
  --asr-locale <locale>   Locale/language hint. Default en-US for macOS Speech, en for OpenAI Realtime.
  --asr-silence-ms <ms>   Stable partial silence before emitting a transcript; default 1100.
  --asr-duration-seconds <n>
                           Stop bundled/helper STT after n seconds; useful for tests.
  --asr-partials          Log partial recognition text from the bundled helper to stderr/JSONL.
  --asr-http-port <port>  Host an HTTP transcript bridge that POSTs transcripts into the HUD runtime.
  --openai-asr-model <id> OpenAI Realtime ASR model; default gpt-realtime-whisper.
  --openai-asr-protocol <mode>
                           auto, legacy, or current. auto uses legacy for gpt-realtime-*.
  --openai-env-file <path>
                           Dotenv file containing OPENAI_API_KEY.
  --openai-asr-ffmpeg-input <input>
                           ffmpeg avfoundation input for Mac mic; default auto.
  --local-hermes           Force the deterministic local Hermes adapter.
  --real-hermes           Force real Hermes when installed.
  --hermes-cli            Open the Hermes terminal view as the default HUD view.
  --hermes-tmux-session <name>
                           Run real Hermes CLI inside a tmux PTY so Terminal can show the normal interactive CLI.
  --hermes-model <id>      Real Hermes model override; default gpt-5.5 for HUD sessions.
  --hermes-reasoning <n>   Real Hermes reasoning effort; default low.
  --no-hermes-fast         Disable automatic /fast fast priming.
  --open-hermes-terminal  Open macOS Terminal attached to --hermes-tmux-session.
  --framebuffer-check     For asr-replay: capture text-only framebuffer hashes before/after when the sidecar is ready.
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
  --local-display          Local display driver; this is the default.
  --real                  Push rendered frames to the real glasses display.
  --real-hardware-ok      Required for legacy real display commands without --real.
  --project-root <path>   peripheral-hud-runtime root.
  --repo-root <path>      Repo root containing macos_corebluetooth.
`);
}

function assertRealHardwareGate(command: string, driverOptions: DriverOptions, realHardwareOk: boolean): void {
  const hardwareCommands = new Set(["push-json", "show-image", "clear", "walkthrough", "measure-latency", "demo"]);
  if (!hardwareCommands.has(command)) return;
  if (driverOptions.local || driverOptions.dryRun || realHardwareOk) return;
  throw new Error(`${command} in live transport mode requires --real-hardware-ok after explicit live-glasses permission.`);
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

function parseMoneyCents(value: unknown, name: string): number {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(name + " is required.");
  const amount = Number(text.replace(/^\$/, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(name + " must be a positive amount.");
  }
  return text.includes(".") ? Math.round(amount * 100) : Math.round(amount);
}

function parseStringArray(value: unknown, name: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? ""));
  } catch {
    throw new Error(name + " must be a JSON array of strings.");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(name + " must be a JSON array of strings.");
  }
  return parsed;
}

function formatMoneyCents(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toFixed(2);
  return currency.toUpperCase() + " " + amount;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readJsonIfPresent(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function artifactMeta(path: string, kind: "json" | "jsonl" | "mp4"): Record<string, unknown> {
  if (!existsSync(path)) {
    return { kind, path, exists: false };
  }
  const bytes = readFileSync(path);
  return {
    kind,
    path,
    exists: true,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
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
