import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_EVENT_KINDS,
  APP_MODES,
  APPROVAL_RISK_LEVELS,
  INPUT_EVENT_KINDS,
  PERIPHERAL_AGENT_MODE_PROTOCOL,
  SURFACE_COMMAND_KINDS,
  SURFACE_KINDS,
  SURFACE_OWNERS,
  SURFACE_PRIORITIES,
  assertAgentEvent,
  assertProtocolEnvelope,
  assertWidget,
} from "../packages/peripheral-protocol/src/index.js";
import { buildDisplayImageFrames, fullPanelSetupPolicy, invertPacked2Bpp } from "../packages/peripheral-driver/src/index.js";
import { buildAgentBridgeAdapters, buildAgentBridgeDossier, buildAgentBridgeLaunchCommand, buildAgentBridgeRuntimeHandshake, buildAgentBridgeTranscript, buildAgentLaunchSpecs, buildAgentRuntimePlan, normalizeAgentCliId, normalizeAgentCliLine, routeAgentBridgeLine, runAgentCliLaunch, surfaceCommandForAgentEvent } from "../packages/peripheral-agent-bridge/src/index.js";
import { buildAgentCliMatrixWidget, buildBrokerTimeline, buildConnectedGlassesEvidence, buildConnectedGlassesState, buildIntegrationSummary, buildIntegrationSupportReport, buildLiveAdapterCatalog, buildPeripheralHardwareProfile, buildPeripheralMcpManifest, buildSponsorMatrixWidget } from "../packages/peripheral-integrations/src/index.js";
import { agentModeLease, approvalSurfaceCommand, applySurfaceCommand, buildPhoneRuntimeSnapshot, createPhoneSurfaceRuntime, routeInputEvent } from "../packages/peripheral-phone-runtime/src/index.js";
import { renderWidgetFile } from "../packages/peripheral-renderer/src/index.js";
import { clearHud, compactHermesTerminalLines, mergeVoiceDraft, normalizeTmuxSessionName, runtimePaths, sanitizeTerminalLine, showHudCard } from "../packages/peripheral-runtime/src/index.js";
import { buildSponsorEventDossier, buildSponsorRuntimeAdapters, buildSponsorRuntimeRequest, createStripePaymentIntent, normalizeAgentPhoneEvent, normalizeBrowserUseEvent, normalizeGeminiRoute, normalizeSponsorEvent, routeGeminiBrokerDecision, routeWithGemini, runAgentPhoneDinnerBooking, runBrowserUseTask, saveDinnerPreference, sendAgentMailConfirmation, submitSpongeContext } from "../packages/peripheral-sponsor-kit/src/index.js";
import { buildSponsorWorkflowDossier, buildSponsorWorkflows, buildSponsorWorkflowWidgets, workflowForSponsor } from "../packages/peripheral-sponsor-workflows/src/index.js";

const root = resolve(process.cwd());
const fixtureDir = join(root, "fixtures", "ui");
const outDir = join(root, "out", "test-frames");

for (const file of readdirSync(fixtureDir).filter((name) => name.endsWith(".json") && !name.startsWith("invalid"))) {
  const input = join(fixtureDir, file);
  const artifact = renderWidgetFile(input, join(outDir, file.replace(/\.json$/, ".png")), {
    assetRoot: join(root, "fixtures", "images"),
  });
  assert.equal(artifact.width, 540);
  assert.equal(artifact.height, 280);
  assert.equal(artifact.stats.rawBytes, 37800);
  assert.ok(artifact.stats.litPixels > 1000, `${file} should render nonblank`);
  assert.ok(existsSync(artifact.pngPath));
  assert.ok(existsSync(artifact.sidecarPath));
  const built = buildDisplayImageFrames(Buffer.from(artifact.pixelsBase64, "base64"));
  assert.ok(built.compressed.length > 0);
  assert.ok(built.frames.length >= 1);
}

assert.throws(() => {
  assertWidget(JSON.parse(readFileSync(join(fixtureDir, "invalid_unknown_type.json"), "utf8")) as unknown);
}, /Unknown widget type/);

assert.ok(APP_MODES.includes("agent_mode"));
assert.ok(SURFACE_OWNERS.includes("broker"));
assert.deepEqual([...SURFACE_PRIORITIES], ["ambient", "normal", "high", "urgent"]);
assert.ok(SURFACE_KINDS.includes("tiny_hud"));
assert.ok(SURFACE_COMMAND_KINDS.includes("update_widget"));
assert.ok(INPUT_EVENT_KINDS.includes("voice_text"));
assert.ok(AGENT_EVENT_KINDS.includes("approval_required"));
assert.ok(APPROVAL_RISK_LEVELS.includes("high"));
const inputEnvelope = assertProtocolEnvelope({
  protocol: PERIPHERAL_AGENT_MODE_PROTOCOL,
  kind: "input_event",
  id: "input-voice-1",
  payload: {
    kind: "voice_text",
    id: "voice-1",
    mode: "agent_mode",
    text: "show status",
    timestamp: "2026-01-01T00:00:00.000Z",
  },
  created_at: "2026-01-01T00:00:00.000Z",
}) as { kind: string; payload: { kind: string } };
assert.equal(inputEnvelope.kind, "input_event");
assert.equal(inputEnvelope.payload.kind, "voice_text");

const integrationSummary = buildIntegrationSummary();
assert.equal(integrationSummary.counts.sponsorCount, 7);
assert.equal(integrationSummary.counts.agentCliCount, 6);
assert.equal(integrationSummary.sponsors.find((sponsor) => sponsor.id === "stripe")?.surfaces.length, 3);
assert.equal(integrationSummary.agentClis.find((agent) => agent.id === "codex_cli")?.command, "codex");
assertWidget(buildSponsorMatrixWidget(new Date("2026-05-17T00:00:00Z")));
assertWidget(buildAgentCliMatrixWidget(new Date("2026-05-17T00:00:00Z")));
const connectedState = buildConnectedGlassesState(new Date("2026-05-17T00:00:00Z"), {
  source: "test_fixture",
  connected: true,
  observedAt: "2026-05-17T00:00:00.000Z",
  connectedDeviceCount: 1,
  batteryPercent: 87,
  rssi: -48,
  firmware: "peripheral-public-runtime",
});
assert.equal(connectedState.glasses.connected, true);
assert.equal(connectedState.glasses.telemetry.source, "test_fixture");
assert.equal(connectedState.glasses.telemetry.batterySource, "live_telemetry");
assert.equal(connectedState.glasses.telemetry.rssiSource, "live_telemetry");
assert.equal(connectedState.phone.ownsBle, true);
assert.equal(connectedState.broker.activeLease.owner, "broker");
assert.ok(connectedState.surfaceCommands.some((command) => command.kind === "enter_agent_mode"));
const runtimeProfileState = buildConnectedGlassesState(new Date("2026-05-17T00:00:00Z"));
assert.equal(runtimeProfileState.glasses.connected, false);
assert.equal(runtimeProfileState.glasses.batteryPercent, undefined);
assert.equal(runtimeProfileState.glasses.rssi, undefined);
assert.equal(runtimeProfileState.glasses.telemetry.source, "phone_gateway_runtime");
assert.equal(runtimeProfileState.glasses.telemetry.batterySource, "phone_gateway_profile");
assert.equal(runtimeProfileState.glasses.telemetry.rssiSource, "phone_gateway_profile");
const gatewayConnectedState = buildConnectedGlassesState(new Date("2026-05-17T00:00:00Z"), buildConnectedGlassesEvidence({
  PERIPHERAL_PHONE_GATEWAY_CONNECTED: "1",
}, new Date("2026-05-17T00:00:00Z")));
assert.equal(gatewayConnectedState.glasses.connected, true);
assert.equal(gatewayConnectedState.glasses.telemetry.source, "operator_env");
const hardwareProfile = buildPeripheralHardwareProfile(new Date("2026-05-17T00:00:00Z"));
assert.equal(hardwareProfile.origin.buildLocation, "Shenzhen");
assert.equal(hardwareProfile.industrialDesign.weightGrams, 28);
assert.equal(hardwareProfile.optics.display, "microled");
assert.equal(hardwareProfile.optics.waveguide, "binocular");
assert.equal(hardwareProfile.battery.expectedHours, "12-24");
assert.ok(hardwareProfile.runtimeBoundaries.some((item) => item.includes("semantic UI")));
const emptySupport = buildIntegrationSupportReport({}, new Date("2026-05-17T00:00:00Z"));
assert.equal(emptySupport.totals.integrations, 13);
assert.equal(emptySupport.totals.configured, 0);
assert.equal(emptySupport.totals.connected, 0);
assert.equal(emptySupport.totals.supported, 13);
assert.equal(emptySupport.totals.liveReady, 13);
assert.equal(emptySupport.integrations.find((item) => item.id === "stripe")?.adapterState, "live_ready");
const support = buildIntegrationSupportReport({ STRIPE_SECRET_KEY: "set" }, new Date("2026-05-17T00:00:00Z"));
assert.equal(support.totals.integrations, 13);
assert.equal(support.totals.configured, 1);
assert.equal(support.totals.connected, 1);
assert.equal(support.totals.supported, 13);
assert.equal(support.totals.liveReady, 13);
assert.equal(support.totals.operations > 30, true);
assert.equal(support.integrations.find((item) => item.id === "stripe")?.credentialNames.includes("STRIPE_SECRET_KEY"), true);
assert.equal(support.integrations.find((item) => item.id === "stripe")?.credentialState, "configured");
assert.equal(support.integrations.find((item) => item.id === "stripe")?.adapterState, "live_ready");
assert.equal(support.note.includes("secret values stay outside the repo"), true);
const allCredentialEnv = Object.fromEntries(
  [...new Set([...integrationSummary.sponsors.flatMap((sponsor) => sponsor.env), ...integrationSummary.agentClis.flatMap((agent) => agent.env)])].map((name) => [name, "set"]),
);
assert.equal(buildIntegrationSupportReport(allCredentialEnv, new Date("2026-05-17T00:00:00Z")).totals.configured, 13);
assert.equal(buildIntegrationSupportReport({ ...allCredentialEnv, STRIPE_PERIPHERAL_ENDPOINT: "https://example.invalid/peripheral/stripe" }, new Date("2026-05-17T00:00:00Z")).totals.liveReady, 13);
const liveAdapters = buildLiveAdapterCatalog(new Date("2026-05-17T00:00:00Z"));
assert.equal(liveAdapters.totals.adapters, 13);
assert.equal(liveAdapters.totals.operationCataloged, liveAdapters.totals.operations);
assert.equal(liveAdapters.totals.liveReady, 13);
assert.equal(liveAdapters.adapters.find((adapter) => adapter.id === "stripe")?.operations.some((operation) => operation.id === "stripe.payment_intents.create"), true);
const manifest = buildPeripheralMcpManifest(new Date("2026-05-17T00:00:00Z"));
assert.ok(manifest.tools.some((tool) => tool.name === "peripheral.request_approval"));
assert.ok(manifest.tools.some((tool) => tool.name === "peripheral.invoke_live_adapter"));
const timeline = buildBrokerTimeline(new Date("2026-05-17T00:00:00Z"));
assert.equal(timeline.steps.length, 5);
assert.ok(timeline.steps.some((step) => step.command.decision_required === true));
assert.equal(buildAgentBridgeAdapters().length, 6);
const launchSpecs = buildAgentLaunchSpecs();
assert.equal(launchSpecs.length, 6);
assert.equal(launchSpecs.find((spec) => spec.id === "codex_cli")?.args.includes("gpt-5.5"), true);
assert.equal(launchSpecs.find((spec) => spec.id === "codex_cli")?.stdout, "line_stream_to_agent_event");
const runtimePlan = buildAgentRuntimePlan(new Date("2026-05-17T00:00:00Z"), "codex_cli", "codex-check");
assert.equal(runtimePlan.schema, "peripheral-agent-runtime-plan-v1");
assert.equal(runtimePlan.agents.length, 1);
assert.equal(runtimePlan.agents[0]?.id, "codex_cli");
assert.equal(runtimePlan.agents[0]?.operatorCommands.start.includes("codex"), true);
assert.equal(runtimePlan.agents[0]?.operatorCommands.route.includes("agent-bridge"), true);
assert.equal(runtimePlan.agents[0]?.glasses.focusedApprovalWinsInput, true);
assert.equal(runtimePlan.agents[0]?.approvals.approve, "approve");
assert.equal(normalizeAgentCliId("claude"), "claude_code");
assert.equal(normalizeAgentCliId("open code"), "opencode");
const bridgeEvent = normalizeAgentCliLine({
  agentId: "codex_cli",
  sessionId: "codex-check",
  line: "Codex needs approval to run npm test.",
  now: new Date("2026-05-17T00:00:00Z"),
});
assertAgentEvent(bridgeEvent);
assert.equal(bridgeEvent.kind, "approval_required");
assert.equal(bridgeEvent.metadata?.adapter_id, "codex_cli");
assert.equal(bridgeEvent.metadata?.surface, "fullscreen");
assert.equal(bridgeEvent.metadata?.decision_required, true);
assert.equal(bridgeEvent.metadata?.confirmation_level, "voice_and_tap");
assertWidget(bridgeEvent.widget!);
const bridgeCommand = surfaceCommandForAgentEvent(bridgeEvent, new Date("2026-05-17T00:00:00Z"));
assert.equal(bridgeCommand.kind, "show_card");
assert.equal(bridgeCommand.surface, "fullscreen");
assert.equal(bridgeCommand.decision_required, true);
assert.equal(bridgeCommand.card?.id, bridgeEvent.widget?.id);
const bridgeRoute = routeAgentBridgeLine({
  agentId: "codex_cli",
  sessionId: "codex-check",
  line: "Codex is 40% through the checks and still running.",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(bridgeRoute.schema, "peripheral-agent-bridge-surface-route-v1");
assert.equal(bridgeRoute.event.kind, "session_progress");
assert.equal(bridgeRoute.command.kind, "show_widget");
assert.equal(bridgeRoute.command.surface, "glance");
assert.equal(bridgeRoute.command.widget?.id, bridgeRoute.widget.id);
const bridgeHandshake = buildAgentBridgeRuntimeHandshake({
  agentId: "codex_cli",
  sessionId: "codex-check",
  line: "Codex needs approval to run npm test.",
  choice: "approve",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(bridgeHandshake.schema, "peripheral-agent-bridge-runtime-handshake-v1");
assert.equal(bridgeHandshake.phoneGateway.surfaceOwner, "phone_runtime");
assert.equal(bridgeHandshake.route.command.kind, "show_card");
assert.equal(bridgeHandshake.approval?.decision.event_id, bridgeHandshake.route.event.id);
assert.equal(bridgeHandshake.approval?.returnPath.transport, "tmux_send_keys");
assert.equal(bridgeHandshake.approval?.returnPath.tmuxCommand?.[0], "tmux");
const agentLaunch = runAgentCliLaunch({
  agentId: "codex_cli",
  sessionId: "codex-launch",
  task: "Run the repo checks.",
  cwd: root,
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(agentLaunch.mode, "phone_gateway");
assert.equal(agentLaunch.runtimePlan.command, "codex");
assert.equal(agentLaunch.events[0]?.kind, "session_started");
assert.equal(agentLaunch.commands[0]?.surface, "glance");
const launchCommand = buildAgentBridgeLaunchCommand({
  agentId: "codex_cli",
  sessionId: "codex-check",
  cwd: root,
  prompt: "Summarize this repo in one sentence.",
  transcriptUri: "peripheral://agent-bridge/codex-check/transcript",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(launchCommand.command, "codex");
assert.equal(launchCommand.cwd, root);
assert.equal(launchCommand.args.includes("Summarize this repo in one sentence."), true);
assert.equal(launchCommand.routeCommand.includes("agent-bridge"), true);
const agentProcessLaunch = runAgentCliLaunch({
  agentId: "codex_cli",
  sessionId: "codex-process",
  task: "Run the repo checks.",
  cwd: root,
  now: new Date("2026-05-17T00:00:00Z"),
}, {
  execute: true,
  commandOverride: process.execPath,
  argsOverride: ["-e", "console.log('Codex needs approval to run npm test'); console.log('Codex completed checks')"],
  timeoutMs: 5_000,
});
assert.equal(agentProcessLaunch.mode, "process");
assert.equal(agentProcessLaunch.ok, true);
assert.equal(agentProcessLaunch.process.status, 0);
assert.equal(agentProcessLaunch.events.some((event) => event.kind === "approval_required"), true);
assert.equal(agentProcessLaunch.commands.some((command) => command.decision_required), true);
const agentLaunchLogDir = mkdtempSync(join(tmpdir(), "peripheral-agent-launch-"));
const agentLaunchLog = join(agentLaunchLogDir, "launch.jsonl");
const agentLaunchRun = spawnSync(process.execPath, [
  "dist/apps/peripheralctl/src/index.js",
  "agent-bridge",
  "launch",
  "--agent",
  "codex_cli",
  "--session-id",
  "codex-process",
  "--task",
  "Run the repo checks.",
  "--execute",
  "--process-command",
  process.execPath,
  "--process-args-json",
  JSON.stringify(["-e", "console.log('Codex needs approval to run npm test')"]),
  "--log",
  agentLaunchLog,
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
});
assert.equal(agentLaunchRun.status, 0, agentLaunchRun.stderr);
const agentLaunchResult = JSON.parse(agentLaunchRun.stdout.slice(agentLaunchRun.stdout.indexOf("{"))) as { launch: { mode: string; logPath: string; events: Array<{ kind: string; references?: Array<{ uri?: string }> }>; commands: Array<{ decision_required?: boolean }> } };
assert.equal(agentLaunchResult.launch.mode, "process");
assert.equal(agentLaunchResult.launch.events.some((event) => event.kind === "approval_required"), true);
assert.equal(agentLaunchResult.launch.commands.some((command) => command.decision_required === true), true);
assert.equal(agentLaunchResult.launch.logPath, agentLaunchLog);
assert.equal(agentLaunchResult.launch.events[0]?.references?.[0]?.uri, agentLaunchLog);
assert.match(readFileSync(agentLaunchLog, "utf8"), /agent-bridge\.launch\.route/);
rmSync(agentLaunchLogDir, { recursive: true, force: true });
assert.equal(buildAgentBridgeTranscript(new Date("2026-05-17T00:00:00Z")).events.length, 6);
assert.equal((buildAgentBridgeDossier(new Date("2026-05-17T00:00:00Z")).routing as string[])[0].includes("Focused approval"), true);
for (const item of [
  { agentId: "openclaw", line: "OpenClaw started the workspace task.", kind: "session_started", surface: "glance", commandKind: "show_widget" },
  { agentId: "claude_code", line: "Claude Code requests permission to edit files.", kind: "approval_required", surface: "fullscreen", commandKind: "show_card" },
  { agentId: "pi", line: "Pi is stuck waiting for a response.", kind: "session_stuck", surface: "pinned", commandKind: "show_widget" },
  { agentId: "opencode", line: "OpenCode is waiting on user input before apply.", kind: "session_waiting", surface: "pinned", commandKind: "show_widget" },
  { agentId: "gemini_cli", line: "Gemini completed the broker summary.", kind: "session_completed", surface: "glance", commandKind: "show_widget" },
  { agentId: "codex_cli", line: "Codex is 40% through the checks and still running.", kind: "session_progress", surface: "glance", commandKind: "show_widget" },
] as const) {
  const route = routeAgentBridgeLine({
    agentId: item.agentId,
    sessionId: item.agentId + "-session",
    line: item.line,
    now: new Date("2026-05-17T00:00:00Z"),
  });
  assert.equal(route.event.kind, item.kind);
  assert.equal(route.event.metadata?.adapter_id, item.agentId);
  assert.equal(route.event.metadata?.surface, item.surface);
  assert.equal(route.command.surface, item.surface);
  assert.equal(route.command.kind, item.commandKind);
  assertWidget(route.widget);
}
const phoneRuntime = createPhoneSurfaceRuntime(new Date("2026-05-17T00:00:00Z"));
const approvalCommand = approvalSurfaceCommand({
  id: "approval-test",
  type: "approval_card",
  title: "Approve?",
  body: "Run local checks.",
  choices: [{ id: "approve", label: "Approve" }],
}, "codex-check", new Date("2026-05-17T00:00:00Z"));
const appliedApproval = applySurfaceCommand(phoneRuntime, approvalCommand, new Date("2026-05-17T00:00:01Z"));
assert.equal(appliedApproval.accepted, true);
assert.equal(appliedApproval.state.focusedCardId, "approval-test");
assert.equal(routeInputEvent(appliedApproval.state, {
  kind: "voice_text",
  id: "voice-approve",
  mode: "agent_mode",
  text: "approve",
  timestamp: "2026-05-17T00:00:02Z",
}).target, "focused_card");
assert.equal(routeInputEvent(phoneRuntime, {
  kind: "voice_text",
  id: "voice-codex",
  mode: "current_stage",
  text: "hey codex start a repo review",
  timestamp: "2026-05-17T00:00:03Z",
}).agentName, "Codex");
assert.equal(agentModeLease("walkthrough", new Date("2026-05-17T00:00:00Z")).owner, "broker");
assert.equal(buildPhoneRuntimeSnapshot(new Date("2026-05-17T00:00:00Z")).routingOrder[0], "focused_card");
const sponsorWorkflows = buildSponsorWorkflows();
assert.equal(sponsorWorkflows.length, 7);
assert.equal(workflowForSponsor("stripe").steps.some((step) => step.approvalRequired), true);
assert.throws(() => workflowForSponsor("not-a-sponsor"), /Unknown sponsor workflow/);
assert.equal(workflowForSponsor("supermemory").steps.some((step) => step.event === "memory_save_requested"), true);
assert.equal(workflowForSponsor("browser_use").steps.some((step) => step.event === "browser_submit_requested"), true);
const sponsorWorkflowDossier = buildSponsorWorkflowDossier(new Date("2026-05-17T00:00:00Z"));
assert.equal(sponsorWorkflowDossier.approvalEvents.length >= 5, true);
assert.equal(sponsorWorkflowDossier.approvalEvents.some((event) => event.risk === "high"), true);
for (const widget of buildSponsorWorkflowWidgets(new Date("2026-05-17T00:00:00Z"))) {
  assertWidget(widget);
}
const sponsorEvents = buildSponsorEventDossier(new Date("2026-05-17T00:00:00Z"));
assert.equal(sponsorEvents.events.length, 7);
assert.equal(sponsorEvents.events.some((event) => event.command.decision_required), true);
const sponsorRuntimeAdapters = buildSponsorRuntimeAdapters({
  STRIPE_SECRET_KEY: "set",
  STRIPE_PERIPHERAL_ENDPOINT: "https://example.invalid/peripheral/stripe",
});
assert.equal(sponsorRuntimeAdapters.length, 7);
assert.equal(sponsorRuntimeAdapters.find((adapter) => adapter.id === "stripe")?.status, "live_ready");
assert.equal(sponsorRuntimeAdapters.find((adapter) => adapter.id === "agentmail")?.status, "live_ready");
assert.equal(sponsorRuntimeAdapters.find((adapter) => adapter.id === "stripe")?.endpointConfigured, true);
const sponsorRuntimeRequest = buildSponsorRuntimeRequest({
  sponsorId: "stripe",
  event: "payment_intent_requires_action",
  sessionId: "test-payment",
  summary: "Approval needed for a refundable card hold.",
  now: new Date("2026-05-17T00:00:00Z"),
}, {
  STRIPE_SECRET_KEY: "set",
  STRIPE_PERIPHERAL_ENDPOINT: "https://example.invalid/peripheral/stripe",
});
assert.equal(sponsorRuntimeRequest.method, "POST");
assert.equal(sponsorRuntimeRequest.endpointConfigured, true);
assert.equal(sponsorRuntimeRequest.headers.authorization?.startsWith("Bearer "), true);
assert.equal(sponsorRuntimeRequest.body.schema, "peripheral-sponsor-runtime-dispatch-v1");
assertWidget(normalizeSponsorEvent({
  sponsorId: "stripe",
  event: "payment_intent_requires_action",
  sessionId: "test-payment",
  summary: "Approval needed for a refundable card hold.",
  now: new Date("2026-05-17T00:00:00Z"),
}).widget);
const agentPhoneDinner = await runAgentPhoneDinnerBooking({
  restaurantName: "Sato Table",
  restaurantPhoneNumber: "+14155550137",
  partySize: 2,
  neighborhood: "Mission",
  bookingName: "Karim",
  preferredWindow: "7:45",
  prompt: "Book dinner for two tonight near Mission, under Karim.",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(agentPhoneDinner.mode, "phone_gateway");
assert.ok(agentPhoneDinner.events.some((event) => event.kind === "approval_required"));
const offeredTimeEvent = agentPhoneDinner.events.find((event) => event.kind === "approval_required");
assert.ok(offeredTimeEvent);
const normalizedOffer = normalizeAgentPhoneEvent(offeredTimeEvent!);
assert.equal(normalizedOffer.event.kind, "approval_required");
assert.equal(normalizedOffer.event.id, "booking-approval-1");
assert.equal(normalizedOffer.command.surface, "fullscreen");
assert.equal(normalizedOffer.command.decision_required, true);
const sponsorOkFetch: typeof fetch = async () => new Response(JSON.stringify({ id: "adapter-ok" }), {
  status: 200,
  headers: { "content-type": "application/json" },
});
const stripeLocal = await createStripePaymentIntent({
  sessionId: "stripe-card-hold",
  amountCents: 2500,
  currency: "usd",
  description: "Refundable dinner hold.",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(stripeLocal.mode, "phone_gateway");
assert.equal(stripeLocal.requestBody.amount, 2500);
assert.equal(stripeLocal.requestBody.capture_method, "manual");
assert.equal((stripeLocal.requestBody.metadata as Record<string, unknown>).approval_surface, "glasses");
const stripeReal = await createStripePaymentIntent({
  sessionId: "stripe-card-hold",
  amountCents: 2500,
  currency: "usd",
  description: "Refundable dinner hold.",
  now: new Date("2026-05-17T00:00:00Z"),
}, {
  forceReal: true,
  env: { STRIPE_SECRET_KEY: "set", STRIPE_API_URL: "https://example.invalid/stripe" },
  fetchImpl: sponsorOkFetch,
});
assert.equal(stripeReal.mode, "real");
assert.equal(stripeReal.ok, true);
assert.equal(stripeReal.endpoint, "https://example.invalid/stripe/payment_intents");
const stripeHoldRun = spawnSync(process.execPath, [
  "dist/apps/peripheralctl/src/index.js",
  "sponsor-runtime",
  "stripe-hold",
  "--hold-amount",
  "25.00",
  "--currency",
  "usd",
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
});
assert.equal(stripeHoldRun.status, 0, stripeHoldRun.stderr);
const stripeHoldResult = JSON.parse(stripeHoldRun.stdout.slice(stripeHoldRun.stdout.indexOf("{"))) as { mode: string; stripe: { requestBody: { amount: number } }; command: { decision_required: boolean } };
assert.equal(stripeHoldResult.mode, "phone_gateway");
assert.equal(stripeHoldResult.stripe.requestBody.amount, 2500);
assert.equal(stripeHoldResult.command.decision_required, true);
const browserUseLocal = await runBrowserUseTask({
  sessionId: "browser-reservation-check",
  task: "Check reservation availability and stop before submit.",
  startUrl: "https://example.com/reservations",
  approvalIntent: "Approve the reservation submit.",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(browserUseLocal.mode, "phone_gateway");
assert.equal(browserUseLocal.requestBody.model, "gemini-3-flash");
assert.equal((browserUseLocal.requestBody.metadata as Record<string, unknown>).approval_surface, "glasses");
assert.ok(browserUseLocal.events.some((event) => event.kind === "browser_submit_requested"));
const browserUseApproval = browserUseLocal.events.find((event) => event.kind === "browser_submit_requested");
assert.ok(browserUseApproval);
const normalizedBrowserUseApproval = normalizeBrowserUseEvent(browserUseApproval!);
assert.equal(normalizedBrowserUseApproval.event.kind, "approval_required");
assert.equal(normalizedBrowserUseApproval.command.surface, "fullscreen");
assert.equal(normalizedBrowserUseApproval.command.decision_required, true);
const browserUseCalls: Array<{ url: string; method?: string }> = [];
const browserUseFetch: typeof fetch = async (url, init) => {
  browserUseCalls.push({ url: String(url), method: init?.method });
  return new Response(JSON.stringify({
    id: "browser-session-1",
    status: "running",
    lastStepSummary: init?.method === "POST" ? "Opened the reservation page." : "Ready to submit reservation.",
    stepCount: init?.method === "POST" ? 1 : 2,
    liveUrl: "https://cloud.browser-use.com/sessions/browser-session-1",
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const browserUseReal = await runBrowserUseTask({
  sessionId: "browser-reservation-check",
  task: "Check reservation availability and stop before submit.",
  startUrl: "https://example.com/reservations",
  now: new Date("2026-05-17T00:00:00Z"),
}, {
  forceReal: true,
  env: { BROWSER_USE_API_KEY: "set", BROWSER_USE_API_URL: "https://example.invalid/browser" },
  fetchImpl: browserUseFetch,
});
assert.equal(browserUseReal.mode, "real");
assert.equal(browserUseReal.ok, true);
assert.equal(browserUseReal.endpoint, "https://example.invalid/browser/sessions");
assert.equal(browserUseCalls.length, 2);
assert.equal(browserUseReal.events.some((event) => event.kind === "browser_submit_requested"), true);
const browserUseRun = spawnSync(process.execPath, [
  "dist/apps/peripheralctl/src/index.js",
  "sponsor-runtime",
  "browser-task",
  "--task",
  "Check reservation availability and stop before submit.",
  "--start-url",
  "https://example.com/reservations",
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
});
assert.equal(browserUseRun.status, 0, browserUseRun.stderr);
const browserUseResult = JSON.parse(browserUseRun.stdout.slice(browserUseRun.stdout.indexOf("{"))) as { mode: string; browserUse: { requestBody: { task: string } }; commands: Array<{ decision_required?: boolean }> };
assert.equal(browserUseResult.mode, "phone_gateway");
assert.match(browserUseResult.browserUse.requestBody.task, /reservations/);
assert.equal(browserUseResult.commands.some((command) => command.decision_required === true), true);
const spongeContext = await submitSpongeContext({
  sessionId: "sponge-context",
  text: "Customer mentioned budget, allergies, and preferred dinner time.",
  projectId: "peripheral-score",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(spongeContext.mode, "phone_gateway");
assert.equal(spongeContext.requestBody.schema, "peripheral-sponge-context-v1");
assert.equal(spongeContext.requestBody.project_id, "peripheral-score");
const spongeReal = await submitSpongeContext({
  sessionId: "sponge-context",
  text: "Summarize the safe context.",
  now: new Date("2026-05-17T00:00:00Z"),
}, {
  forceReal: true,
  env: { SPONGE_API_KEY: "set", SPONGE_API_URL: "https://example.invalid/sponge" },
  fetchImpl: sponsorOkFetch,
});
assert.equal(spongeReal.mode, "real");
assert.equal(spongeReal.endpoint, "https://example.invalid/sponge/context");
const geminiRoute = await routeGeminiBrokerDecision({
  sessionId: "gemini-route",
  prompt: "Route this progress update to the best glasses surface.",
  context: "The wearer is walking and only wants approvals interrupted.",
  model: "gemini-test",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(geminiRoute.mode, "phone_gateway");
assert.equal(geminiRoute.requestBody.schema, "peripheral-gemini-route-v1");
const geminiReal = await routeGeminiBrokerDecision({
  sessionId: "gemini-route",
  prompt: "Pick the surface.",
  model: "gemini-test",
  now: new Date("2026-05-17T00:00:00Z"),
}, {
  forceReal: true,
  env: { GEMINI_API_KEY: "set", GEMINI_API_URL: "https://example.invalid/gemini" },
  fetchImpl: sponsorOkFetch,
});
assert.equal(geminiReal.mode, "real");
assert.equal(geminiReal.endpoint, "https://example.invalid/gemini/models/gemini-test:generateContent");
const geminiFocusedRoute = await routeWithGemini({
  sessionId: "gemini-route-check",
  wearerInput: "approve",
  focusedCardId: "booking-approval-1",
  activeAgents: ["codex_cli", "claude_code"],
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(geminiFocusedRoute.mode, "phone_gateway");
assert.equal(geminiFocusedRoute.decision.route, "focused_card");
assert.equal(geminiFocusedRoute.decision.surface, "tiny_hud");
const normalizedGeminiRoute = normalizeGeminiRoute(geminiFocusedRoute, {
  sessionId: "gemini-route-check",
  wearerInput: "approve",
  focusedCardId: "booking-approval-1",
  activeAgents: ["codex_cli", "claude_code"],
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(normalizedGeminiRoute.event.kind, "session_progress");
assert.equal(normalizedGeminiRoute.command.surface, "tiny_hud");
assertWidget(normalizedGeminiRoute.widget);
const geminiDecisionFetch: typeof fetch = async () => new Response(JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              summary: "Route to Codex status",
              route: "named_agent",
              target: "codex_cli",
              surface: "tiny_hud",
              reason: "The wearer named Codex explicitly.",
            }),
          },
        ],
      },
    },
  ],
}), {
  status: 200,
  headers: { "content-type": "application/json" },
});
const geminiDecisionReal = await routeWithGemini({
  sessionId: "gemini-route-check",
  wearerInput: "hey codex show status",
  activeAgents: ["codex_cli", "claude_code"],
  now: new Date("2026-05-17T00:00:00Z"),
}, {
  forceReal: true,
  env: { GEMINI_API_KEY: "set", GEMINI_API_URL: "https://example.invalid/gemini" },
  fetchImpl: geminiDecisionFetch,
});
assert.equal(geminiDecisionReal.mode, "real");
assert.equal(geminiDecisionReal.ok, true);
assert.equal(geminiDecisionReal.endpoint, "https://example.invalid/gemini/models/gemini-2.5-flash:generateContent");
assert.equal(geminiDecisionReal.decision.target, "codex_cli");
const geminiRouteRun = spawnSync(process.execPath, [
  "dist/apps/peripheralctl/src/index.js",
  "sponsor-runtime",
  "gemini-route",
  "--line",
  "hey codex show status",
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
});
assert.equal(geminiRouteRun.status, 0, geminiRouteRun.stderr);
const geminiRouteResult = JSON.parse(geminiRouteRun.stdout.slice(geminiRouteRun.stdout.indexOf("{"))) as { mode: string; decision: { route: string; target?: string }; command: { surface: string } };
assert.equal(geminiRouteResult.mode, "phone_gateway");
assert.equal(geminiRouteResult.decision.route, "named_agent");
assert.equal(geminiRouteResult.decision.target, "codex_cli");
assert.equal(geminiRouteResult.command.surface, "tiny_hud");
const browserSubmit = normalizeBrowserUseEvent({
  id: "browser-submit-check",
  kind: "browser_submit_requested",
  task: "Check reservation availability and stop before submit.",
  title: "Approve Browser Submit?",
  sessionId: "browser-use-check",
  text: "Browser Use reached the final reservation submit button.",
  status: "WAITING",
  real: false,
  createdAt: "2026-05-17T00:00:00Z",
});
assertAgentEvent(browserSubmit.event);
assertWidget(browserSubmit.widget);
assert.equal(browserSubmit.event.kind, "approval_required");
assert.equal(browserSubmit.command.surface, "fullscreen");
assert.equal(browserSubmit.command.decision_required, true);
const agentMailLocal = await sendAgentMailConfirmation({
  sessionId: "dinner-confirmation-email",
  restaurantName: "Sato Table",
  bookingTime: "7:45",
  partySize: 2,
  bookingName: "Karim",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(agentMailLocal.mode, "phone_gateway");
assert.equal(agentMailLocal.requestBody.schema, "peripheral-agentmail-confirmation-v1");
const agentMailReal = await sendAgentMailConfirmation({
  sessionId: "dinner-confirmation-email",
  restaurantName: "Sato Table",
  bookingTime: "7:45",
  partySize: 2,
  bookingName: "Karim",
  now: new Date("2026-05-17T00:00:00Z"),
}, {
  forceReal: true,
  env: { AGENTMAIL_API_KEY: "set", AGENTMAIL_API_URL: "https://example.invalid/agentmail" },
  fetchImpl: sponsorOkFetch,
});
assert.equal(agentMailReal.mode, "real");
assert.equal(agentMailReal.ok, true);
assert.equal(agentMailReal.endpoint, "https://example.invalid/agentmail/messages");
const supermemoryLocal = await saveDinnerPreference({
  sessionId: "dinner-preference",
  wearerName: "Karim",
  preference: "Saved preference: prefers 7-8pm dinner slots.",
  restaurantName: "Sato Table",
  bookingTime: "7:45",
  now: new Date("2026-05-17T00:00:00Z"),
});
assert.equal(supermemoryLocal.mode, "phone_gateway");
assert.equal(supermemoryLocal.requestBody.schema, "peripheral-supermemory-save-v1");
const supermemoryReal = await saveDinnerPreference({
  sessionId: "dinner-preference",
  wearerName: "Karim",
  preference: "Saved preference: prefers 7-8pm dinner slots.",
  restaurantName: "Sato Table",
  bookingTime: "7:45",
  now: new Date("2026-05-17T00:00:00Z"),
}, {
  forceReal: true,
  env: { SUPERMEMORY_API_KEY: "set", SUPERMEMORY_API_URL: "https://example.invalid/supermemory" },
  fetchImpl: sponsorOkFetch,
});
assert.equal(supermemoryReal.mode, "real");
assert.equal(supermemoryReal.ok, true);
assert.equal(supermemoryReal.endpoint, "https://example.invalid/supermemory/memories");
const dinnerDemoRun = spawnSync(process.execPath, [
  "dist/apps/peripheralctl/src/index.js",
  "demo",
  "dinner-booking",
  "--local",
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 20_000,
});
assert.equal(dinnerDemoRun.status, 0, dinnerDemoRun.stderr);
const dinnerDemoResult = JSON.parse(dinnerDemoRun.stdout.slice(dinnerDemoRun.stdout.indexOf("{"))) as { status: string; timelinePath: string; frameDir: string; logPath: string; steps: number };
assert.equal(dinnerDemoResult.status, "COMPLETED");
assert.ok(dinnerDemoResult.steps >= 6);
assert.ok(existsSync(dinnerDemoResult.timelinePath));
assert.ok(existsSync(join(dinnerDemoResult.frameDir, "01-user-request.png")));
assert.ok(existsSync(join(dinnerDemoResult.frameDir, "04-approval-required.png")));
assert.match(readFileSync(dinnerDemoResult.timelinePath, "utf8"), /WAITING_FOR_APPROVAL/);
assert.ok(existsSync(dinnerDemoResult.logPath));
const reviewBundleRun = spawnSync(process.execPath, [
  "dist/apps/peripheralctl/src/index.js",
  "review-bundle",
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
});
assert.equal(reviewBundleRun.status, 0, reviewBundleRun.stderr);
const reviewBundle = JSON.parse(reviewBundleRun.stdout.slice(reviewBundleRun.stdout.indexOf("{"))) as {
  ok: boolean;
  schema: string;
  artifacts: { frameCount: number; video: { exists: boolean; sha256?: string } };
  experience: { primarySurface: string; browserPreviewSurface: boolean };
  commands: { connectedState: string; phoneRuntime: string; agentRoute: string };
  timeline: { stepCount: number; approvalSteps: number };
  runtime: {
    hardwareAccessRequired: boolean;
    connectedState: {
      schema: string;
      glasses: { transport: string; display: string };
      phone: { ownsBle: boolean };
      surfaceCommandCount: number;
    };
    phoneRuntime: { schema: string; activeLeaseId: string; routingOrder: string[] };
    agentBridge: {
      schema: string;
      eventKind: string;
      commandKind: string;
      surface: string;
      decisionRequired: boolean;
      phoneDecision: { accepted: boolean; focusedCardId: string | null };
    };
  };
};
assert.equal(reviewBundle.ok, true);
assert.equal(reviewBundle.schema, "peripheral-review-bundle-v1");
assert.equal(reviewBundle.experience.primarySurface, "Peripheral glasses");
assert.equal(reviewBundle.experience.browserPreviewSurface, false);
assert.match(reviewBundle.commands.connectedState, /connected-state/);
assert.match(reviewBundle.commands.phoneRuntime, /phone-runtime snapshot/);
assert.match(reviewBundle.commands.agentRoute, /agent-bridge route/);
assert.equal(reviewBundle.timeline.stepCount, dinnerDemoResult.steps);
assert.equal(reviewBundle.timeline.approvalSteps >= 1, true);
assert.equal(reviewBundle.runtime.hardwareAccessRequired, false);
assert.equal(reviewBundle.runtime.connectedState.schema, "peripheral-connected-state-v1");
assert.equal(reviewBundle.runtime.connectedState.glasses.transport, "peripheral_phone_gateway");
assert.equal(reviewBundle.runtime.connectedState.glasses.display, "540x280_2bpp");
assert.equal(reviewBundle.runtime.connectedState.phone.ownsBle, true);
assert.equal(reviewBundle.runtime.connectedState.surfaceCommandCount >= 3, true);
assert.equal(reviewBundle.runtime.phoneRuntime.schema, "peripheral-phone-runtime-snapshot-v1");
assert.equal(reviewBundle.runtime.phoneRuntime.activeLeaseId, "lease-current-stage");
assert.deepEqual(reviewBundle.runtime.phoneRuntime.routingOrder, ["focused_card", "focused_widget", "named_agent", "mode_manager", "broker"]);
assert.equal(reviewBundle.runtime.agentBridge.schema, "peripheral-agent-bridge-surface-route-v1");
assert.equal(reviewBundle.runtime.agentBridge.eventKind, "approval_required");
assert.equal(reviewBundle.runtime.agentBridge.commandKind, "show_card");
assert.equal(reviewBundle.runtime.agentBridge.surface, "fullscreen");
assert.equal(reviewBundle.runtime.agentBridge.decisionRequired, true);
assert.equal(reviewBundle.runtime.agentBridge.phoneDecision.accepted, true);
assert.ok(reviewBundle.runtime.agentBridge.phoneDecision.focusedCardId);
assert.equal(reviewBundle.artifacts.frameCount >= 5, true);
assert.equal(reviewBundle.artifacts.video.exists, true);
assert.equal(typeof reviewBundle.artifacts.video.sha256, "string");
const dinnerDecisionRun = spawnSync(process.execPath, [
  "dist/apps/peripheralctl/src/index.js",
  "phone-runtime",
  "decide",
  "--event",
  "booking-approval-1",
  "--choice",
  "approve",
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
});
assert.equal(dinnerDecisionRun.status, 0, dinnerDecisionRun.stderr);
const dinnerDecisionResult = JSON.parse(dinnerDecisionRun.stdout.slice(dinnerDecisionRun.stdout.indexOf("{"))) as { appliesTo: string; decision: { decision: string } };
assert.equal(dinnerDecisionResult.appliesTo, "booking-approval-1");
assert.equal(dinnerDecisionResult.decision.decision, "approve");
const sponsorIngestRun = spawnSync(process.execPath, [
  "dist/apps/peripheralctl/src/index.js",
  "phone-runtime",
  "ingest",
  "--sponsor",
  "agentphone",
  "--event",
  "call_connected",
  "--session-id",
  "call-ingest",
  "--summary",
  "Restaurant connected and the transcript is ready.",
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
});
assert.equal(sponsorIngestRun.status, 0, sponsorIngestRun.stderr);
const sponsorIngest = JSON.parse(sponsorIngestRun.stdout.slice(sponsorIngestRun.stdout.indexOf("{"))) as {
  schema: string;
  event: { source: { id: string }; kind: string };
  command: { surface: string; decision_required?: boolean };
  decision: { accepted: boolean };
  artifact: { pngPath: string };
  logPath: string;
};
assert.equal(sponsorIngest.schema, "peripheral-phone-runtime-ingest-v1");
assert.equal(sponsorIngest.event.source.id, "agentphone");
assert.equal(sponsorIngest.event.kind, "session_progress");
assert.equal(sponsorIngest.command.surface, "glance");
assert.equal(sponsorIngest.decision.accepted, true);
assert.ok(existsSync(sponsorIngest.artifact.pngPath));
assert.ok(existsSync(sponsorIngest.logPath));
const agentIngestRun = spawnSync(process.execPath, [
  "dist/apps/peripheralctl/src/index.js",
  "phone-runtime",
  "ingest",
  "--payload-json",
  JSON.stringify({
    source: "agent",
    agentId: "codex_cli",
    sessionId: "codex-ingest",
    line: "Codex needs approval to run npm test.",
  }),
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
});
assert.equal(agentIngestRun.status, 0, agentIngestRun.stderr);
const agentIngest = JSON.parse(agentIngestRun.stdout.slice(agentIngestRun.stdout.indexOf("{"))) as {
  event: { kind: string; metadata: { adapter_id: string } };
  command: { surface: string; decision_required?: boolean };
  decision: { accepted: boolean; state: { focusedCardId: string | null } };
};
assert.equal(agentIngest.event.kind, "approval_required");
assert.equal(agentIngest.event.metadata.adapter_id, "codex_cli");
assert.equal(agentIngest.command.surface, "fullscreen");
assert.equal(agentIngest.command.decision_required, true);
assert.equal(agentIngest.decision.accepted, true);
assert.ok(agentIngest.decision.state.focusedCardId);

assert.deepEqual([...invertPacked2Bpp(Buffer.from([0x00, 0x55, 0xaa, 0xff]))], [0xff, 0xaa, 0x55, 0x00]);
const defaultFullPanelSetupPolicy = {
  setupEnabled: true,
  waitForSurfaceReady: true,
  setupStrategy: "factory_hidden_wait_fe01",
  fullPanelPrimedBeforePush: false,
  markPrimedAfterSuccess: false,
};
assert.deepEqual(fullPanelSetupPolicy("", false), defaultFullPanelSetupPolicy);
assert.deepEqual(fullPanelSetupPolicy("0", false), defaultFullPanelSetupPolicy);
assert.deepEqual(fullPanelSetupPolicy("1", false), {
  setupEnabled: true,
  waitForSurfaceReady: false,
  setupStrategy: "factory_hidden_initial_resync_no_wait",
  fullPanelPrimedBeforePush: false,
  markPrimedAfterSuccess: true,
});
assert.deepEqual(fullPanelSetupPolicy("1", true), {
  setupEnabled: false,
  waitForSurfaceReady: false,
  setupStrategy: "skipped_by_env_after_initial_resync",
  fullPanelPrimedBeforePush: true,
  markPrimedAfterSuccess: false,
});
assert.deepEqual(fullPanelSetupPolicy("always", false), {
  setupEnabled: false,
  waitForSurfaceReady: false,
  setupStrategy: "skipped_by_env_forced",
  fullPanelPrimedBeforePush: false,
  markPrimedAfterSuccess: false,
});
assert.equal(sanitizeTerminalLine("╭──────────── Hermes Agent v0.12.0 · upstream ────────────╮"), "Hermes Agent v0.12.0 - upstream");
assert.equal(sanitizeTerminalLine("⚕ gpt-5.5 │ ctx -- │ [░░░░] -- │ 8s │ ⏲ 0s"), "Hermes gpt-5.5 ctx -- [] -- 8s time 0s");
assert.equal(sanitizeTerminalLine("│ ⠀⠀⠀⠀⠀ browser: browser_back, browser_click │"), "browser: browser_back, browser_click");
assert.equal(sanitizeTerminalLine("────────────────────────"), "");
assert.deepEqual(
  compactHermesTerminalLines([
    "╭──────────── Hermes Agent v0.12.0 · upstream ────────────╮",
    "│ Available Tools │",
    "│ ⠀⠀⠀⠀⠀ browser: browser_back, browser_click │",
    "│ code_execution: python, shell │",
    "│ MCP Servers │",
    "│ moss (stdio) — 10 tool(s) │",
    "│ agentmail — failed │",
    "gpt-5.5 - Nous Research sponge (http) - failed",
    "Session: 20260517_155650_397b3d Available Skills",
    "│ Available Skills │",
    "│ apple: app_control, shortcuts │",
    "data-science: jupyter-live-kernel",
    "software-development: code-review, debugging-hermes-tui-commands",
    "│ /Users/karimyahia/Documents/peripheral-framebuffer-mirror │",
    "77 tools · 138 skills · 3 MCP servers · /help for commands",
    "Welcome to Hermes Agent! Type your message or /help for commands.",
    "Tip: Type /help for commands.",
    "⚙️  /reasoning low",
    "  ✓ Reasoning effort set to 'low' (saved to config)",
    "⚙️  /fast fast",
    "  ✓ Priority Processing set to FAST (saved to config)",
    "🔄 MCP server config changed — reloading connections...",
    "🔄 Reloading MCP servers...",
    "  ♻️  Reconnected: agentphone, crustdata, moss",
    "  🔧 46 tool(s) available from 3 server(s)",
    "  ✅ Agent updated — 0 tool(s) available",
    "⚕ gpt-5.5 │ ctx -- │ [░░░░] -- │ 8s │ ⏲ 0s",
    "❯",
  ]),
  ["Hermes Agent v0.12.0 - upstream"],
);
assert.equal(mergeVoiceDraft("Hey", "Hey Hermes", "Hey"), "Hey Hermes");
assert.equal(mergeVoiceDraft("Hey Hermes", "I want you", "Hey Hermes"), "Hey Hermes I want you");
assert.equal(mergeVoiceDraft("One plus", "One plus one", "One plus"), "One plus one");
assert.equal(normalizeTmuxSessionName(" peripheral hud/hermes "), "peripheral_hud_hermes");
assert.equal(normalizeTmuxSessionName(".hud"), "peripheral_.hud");
assert.equal(normalizeTmuxSessionName("!!!"), null);
assert.ok((normalizeTmuxSessionName("x".repeat(120)) || "").length <= 80);

for (const invalidWidget of [
  { id: "bad-checklist", type: "checklist", title: "Bad", items: ["not an item"] },
  { id: "bad-approval", type: "approval_card", title: "Bad", choices: [{}] },
  { id: "bad-transcript", type: "live_call", title: "Bad", transcript: [{}] },
  { id: "bad-people", type: "people_list", title: "Bad", people: [{}] },
  { id: "bad-table", type: "table", title: "Bad", columns: ["A"], rows: [42] },
  { id: "bad-terminal", type: "terminal", title: "Bad", terminal: [42] },
]) {
  assert.throws(() => assertWidget(invalidWidget), /required|must be/);
}

const runtimeRoot = mkdtempSync(join(tmpdir(), "peripheral-hud-runtime-"));
try {
  const options = { projectRoot: runtimeRoot, displayMode: "local" as const, inputMode: "text" as const };
  const paths = runtimePaths(runtimeRoot);
  await showHudCard("Hermes", "Visual result ready", options);
  assert.ok(existsSync(paths.currentWidgetPath), "showHudCard should write current-widget.json");
  const clear = await clearHud(options);
  assert.equal(clear.state, "blank");
  assert.ok(!existsSync(paths.currentWidgetPath), "clearHud should remove stale current-widget.json");
  assert.equal(JSON.parse(readFileSync(paths.statePath, "utf8")).state, "blank");
} finally {
  rmSync(runtimeRoot, { recursive: true, force: true });
}

const hudArgs = [
  "dist/apps/peripheralctl/src/index.js",
  "hud",
  "--local-display",
  "--text",
  "--local-hermes",
  "--json",
  "--cadence-ms",
  "700",
];

const hudProjectRoot = makeTempProjectRoot("hud");
try {
  const hudRun = await runHudWithTimedInput([...hudArgs, ...projectRootArgs(hudProjectRoot)], [
    { input: "look_up\n", waitMs: 250 },
    { input: "Hermes test task\n", waitMs: 900 },
    { input: "status\n", waitMs: 1300 },
    { input: "make it shorter\n", waitMs: 350 },
    { input: "exit\n", waitMs: 0 },
  ]);
  assert.equal(hudRun.status, 0, hudRun.stderr);
  const hudResult = JSON.parse(hudRun.stdout.slice(hudRun.stdout.indexOf("{"))) as { state: string; logPath: string; paths: { currentWidgetPath: string } };
  assert.equal(hudResult.state, "blank");
  const hudLog = readFileSync(hudResult.logPath, "utf8");
  assert.match(hudLog, /"event":"display.clear","reason":"runtime.start"/);
  assert.match(hudLog, /"event":"agents.reset"/);
  assert.match(hudLog, /"state":"agent_hud"/);
  assert.match(hudLog, /"state":"active_agent"/);
  assert.match(hudLog, /"state":"dynamic_result"/);
  assert.match(hudLog, /"text":"status"/);
  assert.match(hudLog, /"reason":"make_it_shorter"/);
  assert.match(hudLog, /"event":"runtime.exit","reason":"exit"/);
  assert.ok(!existsSync(hudResult.paths.currentWidgetPath), "runtime exit should clear current-widget.json after a result");
} finally {
  rmSync(hudProjectRoot, { recursive: true, force: true });
}

const hermesCliProjectRoot = makeTempProjectRoot("hermes-cli");
try {
  const hermesCliRun = await runHudWithTimedInput([...hudArgs, ...projectRootArgs(hermesCliProjectRoot)], [
    { input: "open Hermes\n", waitMs: 350 },
    { input: "summarize this review session\n", waitMs: 950 },
    { input: "close Hermes\n", waitMs: 250 },
    { input: "exit\n", waitMs: 0 },
  ]);
  assert.equal(hermesCliRun.status, 0, hermesCliRun.stderr);
  const hermesCliResult = JSON.parse(hermesCliRun.stdout.slice(hermesCliRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(hermesCliResult.state, "blank");
  const hermesCliLog = readFileSync(hermesCliResult.logPath, "utf8");
  assert.match(hermesCliLog, /"state":"terminal"/);
  assert.match(hermesCliLog, /"widgetId":"hermes-cli"/);
  assert.match(hermesCliLog, /"event":"hermes_cli.input"/);
  assert.match(hermesCliLog, /interactive CLI display path is wired/);
} finally {
  rmSync(hermesCliProjectRoot, { recursive: true, force: true });
}

const asrReplayProjectRoot = makeTempProjectRoot("asr-replay");
try {
  const asrReplayRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "asr-replay",
    "--local-display",
    "--local-hermes",
    "--script",
    join(root, "fixtures", "scripted_asr_run.txt"),
    "--json",
    "--cadence-ms",
    "700",
    ...projectRootArgs(asrReplayProjectRoot),
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(asrReplayRun.status, 0, asrReplayRun.stderr);
  const asrReplayResult = JSON.parse(asrReplayRun.stdout.slice(asrReplayRun.stdout.indexOf("{"))) as { state: string; logPath: string; script: { stepCount: number } };
  assert.equal(asrReplayResult.state, "terminal");
  assert.equal(asrReplayResult.script.stepCount, 5);
  const asrReplayLog = readFileSync(asrReplayResult.logPath, "utf8");
  assert.match(asrReplayLog, /"inputMode":"scripted_asr"/);
  assert.match(asrReplayLog, /"event":"asr.scripted.transcript"/);
  assert.match(asrReplayLog, /"event":"asr.voice_draft.update"/);
  assert.match(asrReplayLog, /"event":"asr.voice_command.send"/);
  assert.match(asrReplayLog, /"event":"hermes_cli.input"/);
  assert.doesNotMatch(asrReplayLog, /"event":"hermes_cli.input","mode":"local","text":"send"/);
  assert.match(asrReplayLog, /"event":"hermes_cli.local_response"/);
  assert.match(asrReplayLog, /asr_replay.awaiting_transcript/);
  assert.match(asrReplayLog, /"event":"asr_replay.complete"/);
} finally {
  rmSync(asrReplayProjectRoot, { recursive: true, force: true });
}

const scriptedSttScript = [
  "setTimeout(() => console.log('Open'), 10)",
  "setTimeout(() => console.log('Hear me'), 90)",
  "setTimeout(() => console.log('ambient should be ignored'), 220)",
  "setTimeout(() => console.log('Hermes voice test prompt'), 350)",
  "setTimeout(() => console.log('send'), 480)",
  "setTimeout(() => console.log('close hermings'), 1200)",
].join(";");
const scriptedSttCommand = JSON.stringify(process.execPath) + " -e " + JSON.stringify(scriptedSttScript);
const voiceHudProjectRoot = makeTempProjectRoot("voice-hud");
try {
  const voiceHudRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "hud",
    "--local-display",
    "--mic",
    "mac",
    "--local-hermes",
    "--stt-cmd",
    scriptedSttCommand,
    "--json",
    "--cadence-ms",
    "700",
    ...projectRootArgs(voiceHudProjectRoot),
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(voiceHudRun.status, 0, voiceHudRun.stderr);
  const voiceHudResult = JSON.parse(voiceHudRun.stdout.slice(voiceHudRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(voiceHudResult.state, "blank");
  const voiceHudLog = readFileSync(voiceHudResult.logPath, "utf8");
  assert.match(voiceHudLog, /"event":"input.mic.start"/);
  assert.match(voiceHudLog, /"event":"input.mic.transcript"/);
  assert.match(voiceHudLog, /"event":"input.voice_command.pending","command":"open"/);
  assert.match(voiceHudLog, /"event":"input.voice_command.alias","text":"Hear me","command":"hermes"/);
  assert.match(voiceHudLog, /"event":"asr.voice_gate.ignored","text":"ambient should be ignored","reason":"waiting_for_hermes"/);
  assert.doesNotMatch(voiceHudLog, /"event":"hermes_cli.input","mode":"local","text":"ambient should be ignored"/);
  assert.match(voiceHudLog, /"event":"asr.voice_gate.open","text":"Hermes voice test prompt","prompt":"voice test prompt"/);
  assert.match(voiceHudLog, /voice test prompt/);
  assert.match(voiceHudLog, /"event":"asr.voice_draft.update"/);
  assert.match(voiceHudLog, /"event":"asr.voice_command.send"/);
  assert.match(voiceHudLog, /"event":"hermes_cli.input"/);
  assert.match(voiceHudLog, /"event":"hermes_cli.input","mode":"local","text":"voice test prompt"/);
  assert.doesNotMatch(voiceHudLog, /"event":"hermes_cli.input","mode":"local","text":"send"/);
  assert.match(voiceHudLog, /"text":"close hermings"/);
  assert.match(voiceHudLog, /"event":"hermes_cli.close","reason":"input.dismiss"/);
} finally {
  rmSync(voiceHudProjectRoot, { recursive: true, force: true });
}

const scriptedAliasSttScript = [
  "setTimeout(() => console.log('Pinot noir'), 10)",
  "setTimeout(() => console.log('close Hermes'), 140)",
  "setTimeout(() => console.log('Finn Hermes'), 280)",
  "setTimeout(() => console.log('close Hermes'), 410)",
  "setTimeout(() => console.log('Open for me'), 540)",
  "setTimeout(() => console.log('Close her'), 670)",
  "setTimeout(() => console.log('Okay well I will do this open'), 800)",
  "setTimeout(() => console.log('Hermes'), 930)",
  "setTimeout(() => console.log('Hear me say hello'), 1060)",
  "setTimeout(() => console.log('send'), 1190)",
  "setTimeout(() => console.log('Close her'), 1320)",
].join(";");
const scriptedAliasSttCommand = JSON.stringify(process.execPath) + " -e " + JSON.stringify(scriptedAliasSttScript);
const voiceAliasProjectRoot = makeTempProjectRoot("voice-alias");
try {
  const voiceAliasRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "hud",
    "--local-display",
    "--mic",
    "mac",
    "--local-hermes",
    "--stt-cmd",
    scriptedAliasSttCommand,
    "--json",
    "--cadence-ms",
    "700",
    ...projectRootArgs(voiceAliasProjectRoot),
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(voiceAliasRun.status, 0, voiceAliasRun.stderr);
  const voiceAliasResult = JSON.parse(voiceAliasRun.stdout.slice(voiceAliasRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(voiceAliasResult.state, "blank");
  const voiceAliasLog = readFileSync(voiceAliasResult.logPath, "utf8");
  assert.match(voiceAliasLog, /"event":"input.voice_command.alias","text":"Pinot noir","command":"open hermes"/);
  assert.match(voiceAliasLog, /"event":"input.voice_command.alias","text":"Finn Hermes","command":"open hermes"/);
  assert.match(voiceAliasLog, /"event":"input.voice_command.alias","text":"Open for me","command":"open hermes"/);
  assert.match(voiceAliasLog, /"text":"Close her"/);
  assert.match(voiceAliasLog, /"event":"input.voice_command.pending","command":"open"/);
  assert.match(voiceAliasLog, /"event":"asr.voice_gate.open","text":"Hear me say hello","prompt":"say hello"/);
  assert.match(voiceAliasLog, /"event":"hermes_cli.input","mode":"local","text":"say hello"/);
  assert.match(voiceAliasLog, /"event":"hermes_cli.close","reason":"input.dismiss"/);
  assert.doesNotMatch(voiceAliasLog, /Unknown HUD command/);
} finally {
  rmSync(voiceAliasProjectRoot, { recursive: true, force: true });
}

const scriptedOpenOnlySttScript = [
  "setTimeout(() => console.log('Open'), 10)",
  "setTimeout(() => console.log('close Hermes'), 1500)",
].join(";");
const scriptedOpenOnlySttCommand = JSON.stringify(process.execPath) + " -e " + JSON.stringify(scriptedOpenOnlySttScript);
const voiceOpenOnlyProjectRoot = makeTempProjectRoot("voice-open-only");
try {
  const voiceOpenOnlyRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "hud",
    "--local-display",
    "--mic",
    "mac",
    "--local-hermes",
    "--stt-cmd",
    scriptedOpenOnlySttCommand,
    "--json",
    "--cadence-ms",
    "700",
    ...projectRootArgs(voiceOpenOnlyProjectRoot),
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(voiceOpenOnlyRun.status, 0, voiceOpenOnlyRun.stderr);
  const voiceOpenOnlyResult = JSON.parse(voiceOpenOnlyRun.stdout.slice(voiceOpenOnlyRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(voiceOpenOnlyResult.state, "blank");
  const voiceOpenOnlyLog = readFileSync(voiceOpenOnlyResult.logPath, "utf8");
  assert.match(voiceOpenOnlyLog, /"event":"input.voice_command.pending","command":"open"/);
  assert.match(voiceOpenOnlyLog, /"event":"input.voice_command.pending_timeout","command":"open","fallback":"open"/);
  assert.match(voiceOpenOnlyLog, /"state":"terminal"/);
  assert.match(voiceOpenOnlyLog, /"event":"hermes_cli.close","reason":"input.dismiss"/);
} finally {
  rmSync(voiceOpenOnlyProjectRoot, { recursive: true, force: true });
}

const openAiAsrSelfTest = spawnSync(process.execPath, [
  "tools/openai-realtime-asr.mjs",
  "--self-test",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 5_000,
});
assert.equal(openAiAsrSelfTest.status, 0, openAiAsrSelfTest.stderr);
assert.match(openAiAsrSelfTest.stdout, /openai realtime asr self-test ok/);

const exitProjectRoot = makeTempProjectRoot("exit");
try {
  const exitRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "hud",
    "--local-display",
    "--text",
    "--json",
    ...projectRootArgs(exitProjectRoot),
  ], {
    cwd: root,
    input: "exit\n",
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(exitRun.status, 0, exitRun.stderr);
  const exitResult = JSON.parse(exitRun.stdout.slice(exitRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(exitResult.state, "blank");
  assert.match(readFileSync(exitResult.logPath, "utf8"), /"event":"runtime.exit","reason":"exit"/);
} finally {
  rmSync(exitProjectRoot, { recursive: true, force: true });
}

console.log("renderer-smoke ok");

function runHudWithTimedInput(args: string[], script: { input: string; waitMs: number }[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectRun(new Error("Timed out waiting for HUD runtime"));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.on("exit", (status) => {
      clearTimeout(timeout);
      resolveRun({ status, stdout, stderr });
    });
    void (async () => {
      for (const step of script) {
        child.stdin.write(step.input, "utf8");
        if (step.waitMs > 0) await delay(step.waitMs);
      }
      child.stdin.end();
    })().catch((error: unknown) => {
      child.kill("SIGTERM");
      rejectRun(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function makeTempProjectRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), "peripheral-hud-" + label + "-"));
}

function projectRootArgs(projectRoot: string): string[] {
  return ["--project-root", projectRoot, "--repo-root", resolve(root, "..")];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
