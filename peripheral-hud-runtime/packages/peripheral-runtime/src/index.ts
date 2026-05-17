import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, watch } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  AGENT_STATUSES,
  assertWidget,
  cleanText,
  type AgentStatus,
  type PeripheralWidget,
  type HudRuntimeState,
} from "../../peripheral-protocol/src/index.js";
import { renderWidgetToFile } from "../../peripheral-renderer/src/index.js";
import {
  appendJsonl,
  clearDisplay,
  defaultLogPath,
  pushArtifact,
  status as driverStatus,
  type DriverOptions,
} from "../../peripheral-driver/src/index.js";

export type HudInputMode = "text" | "mac_mic" | "mock_asr";
export type HudDisplayMode = "mock" | "real";
export type HermesMode = "auto" | "mock" | "real";
export type AsrProvider = "auto" | "openai-realtime" | "macos-speech";

export type AgentRecord = {
  name: string;
  status: AgentStatus;
  summary?: string;
  command?: string;
  installed?: boolean;
  path?: string | null;
  real?: boolean;
  updatedAt: string;
};

export type HudRuntimeOptions = {
  projectRoot: string;
  repoRoot?: string;
  displayMode: HudDisplayMode;
  inputMode: HudInputMode;
  hermesMode?: HermesMode;
  startHermesCli?: boolean;
  sttCommand?: string;
  asrProvider?: AsrProvider;
  asrLocale?: string;
  asrSilenceMs?: number;
  asrDurationSeconds?: number;
  asrPartials?: boolean;
  asrHttpPort?: number;
  openaiAsrModel?: string;
  openaiAsrProtocol?: string;
  openaiEnvFile?: string;
  openaiAsrFfmpegInput?: string;
  hermesTmuxSession?: string;
  hermesModel?: string;
  hermesReasoningEffort?: string;
  hermesFastMode?: boolean;
  openHermesTerminal?: boolean;
  logPath?: string;
  json?: boolean;
  cadenceMs?: number;
};

export type RuntimePaths = {
  runtimeRoot: string;
  outDir: string;
  currentWidgetPath: string;
  statePath: string;
  agentStatusPath: string;
};

export type ScriptedTranscriptStep = {
  text: string;
  waitMs?: number;
};

export type TextAsrDemoOptions = {
  steps: ScriptedTranscriptStep[];
  stepDelayMs?: number;
  startBlank?: boolean;
  leavePrompt?: boolean;
};

type TranscriptSource = {
  command: string;
  done: Promise<void>;
  close: () => void;
};

type TranscriptInputSource = "manual" | "voice";

type HermesCliSession = {
  mode: "mock" | "real";
  child: ChildProcessWithoutNullStreams | null;
  startedAt: number;
  tmuxSession?: string;
  tmuxPath?: string;
  tmuxCaptureTimer?: NodeJS.Timeout | null;
  tmuxLastSnapshot?: string;
  tmuxOwnsSession?: boolean;
};

export function runtimePaths(projectRoot: string): RuntimePaths {
  const runtimeRoot = join(projectRoot, ".peripheral-hud");
  const outDir = join(runtimeRoot, "out");
  return {
    runtimeRoot,
    outDir,
    currentWidgetPath: join(outDir, "current-widget.json"),
    statePath: join(outDir, "state.json"),
    agentStatusPath: join(outDir, "agent-status.json"),
  };
}

export function defaultHudLogPath(projectRoot: string, label = "hud-runtime"): string {
  return defaultLogPath(projectRoot, label);
}

export async function listAgents(options: HudRuntimeOptions): Promise<Record<string, unknown>> {
  const agents = await buildAgentRegistry(options.projectRoot);
  const logPath = options.logPath || defaultHudLogPath(options.projectRoot, "agents");
  await appendJsonl(logPath, { event: "agents.list", agents });
  return { ok: true, agents, logPath };
}

export async function runHudRuntime(options: HudRuntimeOptions): Promise<Record<string, unknown>> {
  const paths = ensureRuntime(options.projectRoot);
  const logPath = options.logPath || defaultHudLogPath(options.projectRoot);
  const driverOptions = runtimeDriverOptions(options, logPath);
  const cadenceMs = options.cadenceMs || 1400;
  const runtime = new HudRuntime(options, driverOptions, paths, logPath, cadenceMs);
  await runtime.setState("blank", { reason: "runtime.start", displayMode: options.displayMode, inputMode: options.inputMode });
  await runtime.clearCurrentWidget("runtime.start");
  await runtime.blankDisplay("runtime.start");
  await runtime.resetAgents();
  if (options.startHermesCli) {
    await runtime.openHermesCli("runtime.start");
  }

  const watcher = runtime.watchCurrentWidget();
  const transcriptSources: TranscriptSource[] = [];
  try {
    if (options.inputMode === "mac_mic") {
      const micSource = runtime.startMacMicTranscriptSource();
      if (micSource) {
        transcriptSources.push(micSource);
      } else {
        await runtime.log({ event: "input.mic_unavailable", note: "No Mac mic STT command is configured or available; text fallback remains active." });
        if (process.stdin.isTTY) process.stdout.write("Mac mic STT is not configured or available. Text fallback is active.\n");
      }
    }
    if (options.asrHttpPort !== undefined) {
      transcriptSources.push(await runtime.startHttpTranscriptSource(options.asrHttpPort));
    }

    if (process.stdin.isTTY) {
      process.stdout.write("HUD runtime started blank. Type look_up, open Hermes, Hermes <task>, status, show agents, details, make it shorter, dismiss, clear, timeout, exit, or quit.\n");
      process.stdout.write("hud> ");
    }

    if (transcriptSources.length > 0 && !process.stdin.isTTY) {
      await waitForTranscriptSources(transcriptSources, options.asrDurationSeconds);
    } else {
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
      for await (const line of rl) {
        const keepRunning = await runtime.handleTranscript(String(line), "manual");
        if (!keepRunning) break;
        if (process.stdin.isTTY) process.stdout.write("hud> ");
      }
      rl.close();
    }
    await runtime.waitForTranscriptQueue();
    await runtime.waitForPendingAgent();
    return { ok: true, mode: "hud", state: runtime.currentState, logPath, paths };
  } finally {
    runtime.shutdown();
    transcriptSources.forEach((source) => source.close());
    watcher?.close();
  }
}

export async function runTextAsrDemo(options: HudRuntimeOptions, demo: TextAsrDemoOptions): Promise<Record<string, unknown>> {
  const runtimeOptions: HudRuntimeOptions = { ...options, inputMode: "mock_asr" };
  const paths = ensureRuntime(options.projectRoot);
  const logPath = options.logPath || defaultHudLogPath(options.projectRoot, "asr-demo");
  const driverOptions = runtimeDriverOptions(runtimeOptions, logPath);
  const cadenceMs = options.cadenceMs || 1400;
  const runtime = new HudRuntime(runtimeOptions, driverOptions, paths, logPath, cadenceMs);
  const appliedSteps: Array<{ index: number; text: string; keepRunning: boolean }> = [];
  try {
    await runtime.setState("blank", { reason: "asr_demo.start", displayMode: runtimeOptions.displayMode, inputMode: runtimeOptions.inputMode });
    await runtime.clearCurrentWidget("asr_demo.start");
    if (demo.startBlank !== false) {
      await runtime.blankDisplay("asr_demo.start");
    }
    await runtime.resetAgents();

    let keepRunning = true;
    for (const [index, step] of demo.steps.entries()) {
      if (!keepRunning) break;
      const text = cleanText(step.text, 240);
      if (!text) continue;
      const waitMs = Math.max(0, step.waitMs ?? demo.stepDelayMs ?? cadenceMs);
      await runtime.log({ event: "asr.mock.transcript", index, text, waitMs });
      keepRunning = await runtime.handleTranscript(text, "voice");
      appliedSteps.push({ index, text, keepRunning });
      if (keepRunning && waitMs > 0) {
        await delay(waitMs);
      }
    }

    await runtime.waitForPendingAgent();
    if (demo.leavePrompt !== false && runtime.currentState === "terminal") {
      await runtime.showAsrPrompt("asr_demo.awaiting_transcript");
    }
    await runtime.log({ event: "asr_demo.complete", steps: appliedSteps.length, state: runtime.currentState });
    return {
      ok: true,
      mode: "asr-demo",
      state: runtime.currentState,
      steps: appliedSteps,
      logPath,
      paths,
      displayMode: options.displayMode,
      hermesMode: options.hermesMode || "auto",
    };
  } finally {
    runtime.shutdown();
  }
}

export async function showHudJson(filePath: string, options: HudRuntimeOptions): Promise<Record<string, unknown>> {
  const paths = ensureRuntime(options.projectRoot);
  const logPath = options.logPath || defaultHudLogPath(options.projectRoot, "hudctl");
  const driverOptions = runtimeDriverOptions(options, logPath);
  const raw = JSON.parse(readFileSync(resolve(filePath), "utf8")) as unknown;
  const widget = assertWidget(raw);
  await writeFile(paths.currentWidgetPath, JSON.stringify(widget, null, 2) + "\n", "utf8");
  await writeStateAndLog(paths, logPath, "dynamic_result", { source: resolve(filePath), logPath });
  const result = await renderPushAndLog(widget, options, driverOptions, logPath, "hudctl.show-json");
  return { ok: true, widgetPath: paths.currentWidgetPath, ...result };
}

export async function showHudCard(title: string, body: string, options: HudRuntimeOptions): Promise<Record<string, unknown>> {
  const widget: PeripheralWidget = {
    id: "hudctl-card",
    type: "generic_card",
    title: cleanText(title, 80) || "HUD Card",
    body: cleanText(body, 300) || "No body supplied.",
    status: "HUD",
    created_at: new Date().toISOString(),
  };
  return showInlineWidget(widget, options, "hudctl.show-card");
}

export async function clearHud(options: HudRuntimeOptions): Promise<Record<string, unknown>> {
  const paths = ensureRuntime(options.projectRoot);
  const logPath = options.logPath || defaultHudLogPath(options.projectRoot, "hudctl");
  const driverOptions = runtimeDriverOptions(options, logPath);
  await writeStateAndLog(paths, logPath, "blank", { reason: "hudctl.clear", logPath });
  await clearCurrentWidgetFile(paths, logPath, "hudctl.clear");
  const started = performance.now();
  const clear = await clearDisplay(driverOptions);
  await appendJsonl(logPath, { event: "hud.clear", state: "blank", clear, elapsedMs: roundMs(performance.now() - started) });
  return { ok: true, state: "blank", clear, logPath };
}

export async function hudStatus(options: HudRuntimeOptions): Promise<Record<string, unknown>> {
  const paths = ensureRuntime(options.projectRoot);
  const logPath = options.logPath || defaultHudLogPath(options.projectRoot, "hudctl");
  const agents = await buildAgentRegistry(options.projectRoot);
  const state = readJsonIfExists(paths.statePath) || { state: "blank" };
  const driver = await driverStatus(runtimeDriverOptions(options, logPath));
  await appendJsonl(logPath, { event: "hud.status", state, agents });
  return { ok: true, state, agents, driver, paths, logPath };
}

export async function emitAgentStatus(agent: string, status: AgentStatus, options: HudRuntimeOptions): Promise<Record<string, unknown>> {
  if (!isAgentStatus(status)) {
    throw new Error("Unknown agent status " + status + ". Use one of: " + AGENT_STATUSES.join(", ") + ".");
  }
  const paths = ensureRuntime(options.projectRoot);
  const logPath = options.logPath || defaultHudLogPath(options.projectRoot, "hudctl");
  const agents = await buildAgentRegistry(options.projectRoot);
  const normalized = normalizeAgentName(agent);
  const next = upsertAgent(agents, {
    name: normalized,
    status,
    summary: "Manual status: " + status,
    updatedAt: new Date().toISOString(),
  });
  await writeFile(paths.agentStatusPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  await appendJsonl(logPath, { event: "agent.status.manual", agent: normalized, status });
  await writeStateAndLog(paths, logPath, "agent_hud", { reason: "hudctl.emit-agent-status", agent: normalized, status, logPath });
  const widget = agentHudWidget(next);
  const result = await renderPushAndLog(widget, options, runtimeDriverOptions(options, logPath), logPath, "hudctl.emit-agent-status");
  return { ok: true, agents: next, ...result };
}

async function showInlineWidget(widget: PeripheralWidget, options: HudRuntimeOptions, reason: string): Promise<Record<string, unknown>> {
  const paths = ensureRuntime(options.projectRoot);
  const logPath = options.logPath || defaultHudLogPath(options.projectRoot, "hudctl");
  const valid = assertWidget(widget);
  await writeFile(paths.currentWidgetPath, JSON.stringify(valid, null, 2) + "\n", "utf8");
  await writeStateAndLog(paths, logPath, "dynamic_result", { reason, logPath });
  const result = await renderPushAndLog(valid, options, runtimeDriverOptions(options, logPath), logPath, reason);
  return { ok: true, widgetPath: paths.currentWidgetPath, ...result };
}

class HudRuntime {
  currentState: HudRuntimeState = "blank";
  private agents: AgentRecord[] = [];
  private pendingAgent: Promise<void> | null = null;
  private lastWidget: PeripheralWidget | null = null;
  private lastWidgetJson = "";
  private lastWidgetMtime = 0;
  private activeAgentRunId = 0;
  private cancelledAgentRuns = new Set<number>();
  private hermesCli: HermesCliSession | null = null;
  private terminalLines: string[] = [];
  private terminalRenderTimer: NodeJS.Timeout | null = null;
  private terminalRenderInFlight: Promise<Record<string, unknown>> | null = null;
  private transcriptQueue: Promise<void> = Promise.resolve();
  private voiceDraft = "";
  private voiceDraftLineIndex: number | null = null;
  private lastVoiceDraftPiece = "";
  private pendingVoiceControlPrefix: string | null = null;
  private voicePromptArmed = false;

  constructor(
    private readonly options: HudRuntimeOptions,
    private readonly driverOptions: DriverOptions,
    private readonly paths: RuntimePaths,
    private readonly logPath: string,
    private readonly cadenceMs: number,
  ) {}

  async log(event: Record<string, unknown>): Promise<void> {
    await appendJsonl(this.logPath, event);
  }

  async resetAgents(): Promise<void> {
    this.agents = await buildAgentRegistry(this.options.projectRoot, { includeCache: false });
    await writeFile(this.paths.agentStatusPath, JSON.stringify(this.agents, null, 2) + "\n", "utf8");
    await this.log({ event: "agents.reset", agents: this.agents });
  }

  async refreshAgents(): Promise<void> {
    this.agents = await buildAgentRegistry(this.options.projectRoot);
    await writeFile(this.paths.agentStatusPath, JSON.stringify(this.agents, null, 2) + "\n", "utf8");
    await this.log({ event: "agents.refresh", agents: this.agents });
  }

  async setState(state: HudRuntimeState, extra: Record<string, unknown> = {}): Promise<void> {
    this.currentState = state;
    await writeState(this.paths, state, { ...extra, logPath: this.logPath });
    await this.log({ event: "state.change", state, ...extra });
  }

  async handleTranscript(input: string, source: TranscriptInputSource = "manual"): Promise<boolean> {
    const text = cleanText(input, 240);
    if (!text) return true;
    await this.log({ event: "input.command", mode: this.options.inputMode, source, text });
    const lower = source === "voice" ? normalizeVoiceControlCommand(text) : text.toLowerCase();
    const voiceCommand = source === "voice" ? normalizeHermesVoiceCommandAlias(lower) : lower;

    if (this.hermesCli) {
      return this.handleHermesCliInput(text, voiceCommand, source);
    }

    if (source === "voice") {
      const pendingCommand = consumeSplitHermesControlCommand(this.pendingVoiceControlPrefix, voiceCommand);
      if (pendingCommand === "open") {
        this.pendingVoiceControlPrefix = null;
        await this.log({ event: "input.voice_command.alias", text, command: voiceCommand });
        await this.openHermesCli("input.voice_command");
        return true;
      }
      if (isHermesOpenPrefix(voiceCommand)) {
        this.pendingVoiceControlPrefix = voiceCommand;
        await this.log({ event: "input.voice_command.pending", command: voiceCommand });
        return true;
      }
      this.pendingVoiceControlPrefix = null;
    }

    if (["look_up", "lookup", "look up", "show agents"].includes(voiceCommand)) {
      await this.showAgentHud("look_up");
      return true;
    }
    if (voiceCommand === "status") {
      await this.showAgentHud("status");
      return true;
    }
    if (voiceCommand === "details") {
      await this.showDetails();
      return true;
    }
    if (voiceCommand === "dismiss" || voiceCommand === "clear" || voiceCommand === "timeout") {
      await this.clear(voiceCommand === "timeout" ? "input.timeout" : "input.dismiss");
      return true;
    }
    if (voiceCommand === "make it shorter") {
      await this.makeShorter();
      return true;
    }
    if (voiceCommand === "exit" || voiceCommand === "quit") {
      await this.clear("input.exit");
      await this.log({ event: "runtime.exit", reason: voiceCommand });
      return false;
    }
    if (isHermesCliCommand(voiceCommand)) {
      if (source === "voice" && voiceCommand !== lower) await this.log({ event: "input.voice_command.alias", text, command: voiceCommand });
      await this.openHermesCli("input.command");
      return true;
    }
    if (voiceCommand.startsWith("hermes ")) {
      const task = text.slice(text.toLowerCase().indexOf("hermes ") + "hermes ".length).trim();
      await this.launchHermes(task || "Summarize current task for the HUD.");
      return true;
    }

    if (source === "voice") {
      await this.log({ event: "input.voice_ignored", text });
      return true;
    }

    await this.showError("Unknown HUD command: " + text);
    return true;
  }

  async waitForTranscriptQueue(): Promise<void> {
    await this.transcriptQueue.catch((error: unknown) => this.log({
      event: "input.transcript_queue_error",
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  async showAgentHud(reason: string): Promise<void> {
    await this.refreshAgents();
    await this.setState("agent_hud", { reason });
    await this.renderPush(agentHudWidget(this.agents), "agent_hud");
  }

  async openHermesCli(reason: string): Promise<void> {
    if (this.hermesCli) {
      this.pushTerminalLine("HUD: Hermes CLI is already open.");
      await this.renderTerminal("hermes_cli.already_open");
      return;
    }
    if (this.pendingAgent) {
      await this.updateAgentStatus("Hermes", "waiting", "Hermes one-shot is already running.");
      await this.renderPush(activeAgentWidget("Hermes", "waiting", ["One-shot Hermes is already running.", "Wait or dismiss before opening CLI."]), "hermes_cli.blocked");
      return;
    }

    const detected = detectHermes();
    const mode = resolveHermesMode(this.options, detected.installed);
    this.terminalLines = [];
    this.voiceDraft = "";
    this.voiceDraftLineIndex = null;
    this.lastVoiceDraftPiece = "";
    this.pendingVoiceControlPrefix = null;
    this.voicePromptArmed = false;
    this.pushTerminalLine("$ hermes chat");
    this.pushTerminalLine(mode === "real" ? "HUD: launching native Hermes CLI." : "HUD: mock Hermes CLI view.");
    this.pushTerminalLine(this.options.inputMode === "mac_mic" || this.options.inputMode === "mock_asr"
      ? "HUD: speak a prompt draft, then say send. Use exit cli to close."
      : "HUD: type prompts normally; use exit cli to close this view.");
    this.hermesCli = { mode, child: null, startedAt: performance.now() };
    await this.updateAgentStatus("Hermes", "running", mode === "real" ? "Native CLI view active." : "Mock CLI view active.");
    await this.setState("terminal", { agent: "Hermes", reason, mode });
    await this.renderTerminal("hermes_cli.open");

    if (mode === "real" && detected.installed && detected.path) {
      this.startRealHermesCli(detected.path);
    } else {
      this.pushTerminalLine("Hermes(mock)> ready");
      await this.renderTerminal("hermes_cli.mock_ready");
    }
  }

  async showDetails(): Promise<void> {
    const hermes = this.agents.find((agent) => agent.name.toLowerCase() === "hermes");
    const widget: PeripheralWidget = {
      id: "agent-details",
      type: "generic_card",
      title: "Agent Details",
      status: hermes?.status || "idle",
      body: hermes?.installed
        ? "Hermes is installed at " + hermes.path + ". Say Hermes CLI for the native terminal view, or Hermes plus a task for one-shot mode."
        : "Hermes was not detected. The HUD runtime will use the mock adapter.",
      bullets: this.agents.map((agent) => agent.name + ": " + agent.status),
      footer: "NO TOUCH REQUIRED",
      created_at: new Date().toISOString(),
    };
    await this.setState("agent_hud", { reason: "details" });
    await this.renderPush(widget, "details");
  }

  async makeShorter(): Promise<void> {
    const source = this.lastWidget;
    const body = source?.body || source?.bullets?.[0] || source?.title || "No active result.";
    const widget: PeripheralWidget = {
      id: "shorter-result",
      type: "generic_card",
      title: "Short Version",
      status: "COMPACT",
      body: cleanText(body, 96),
      footer: "SAY DETAILS FOR MORE",
      created_at: new Date().toISOString(),
    };
    await this.setState("dynamic_result", { reason: "make_it_shorter" });
    await this.renderPush(widget, "make_it_shorter");
  }

  async clear(reason: string): Promise<void> {
    this.cancelActiveAgentDisplay(reason);
    this.stopHermesCliProcess(reason);
    await this.setState("blank", { reason });
    await this.clearCurrentWidget(reason);
    await this.blankDisplay(reason);
  }

  async blankDisplay(reason: string): Promise<void> {
    const started = performance.now();
    const clear = await clearDisplay(this.driverOptions);
    await this.log({ event: "display.clear", reason, clear, elapsedMs: roundMs(performance.now() - started) });
  }

  async clearCurrentWidget(reason: string): Promise<void> {
    this.lastWidget = null;
    this.lastWidgetJson = "";
    this.lastWidgetMtime = 0;
    await clearCurrentWidgetFile(this.paths, this.logPath, reason);
  }

  async showError(message: string): Promise<void> {
    await this.setState("error", { message });
    await this.renderPush(errorWidget(message), "error");
  }

  async showAsrPrompt(reason: string): Promise<void> {
    if (this.currentState !== "terminal" || !this.hermesCli) return;
    this.pushTerminalLine("ASR: speak a prompt draft, then say send.");
    this.setVoiceDraftLine();
    await this.renderTerminal(reason);
  }

  async launchHermes(task: string): Promise<void> {
    if (this.pendingAgent) {
      await this.updateAgentStatus("Hermes", "waiting", "Hermes is already running.");
      await this.setState("active_agent", { agent: "Hermes", reason: "already_running" });
      await this.renderPush(activeAgentWidget("Hermes", "waiting", [
        "Hermes is already running.",
        "Say status, details, dismiss, or wait.",
      ]), "hermes.already_running");
      return;
    }

    const runId = this.nextAgentRunId();
    let pending: Promise<void> | null = null;
    pending = this.runHermes(task, runId)
      .catch((error: unknown) => this.handleAgentRunError(runId, error))
      .finally(() => {
        if (pending && this.pendingAgent === pending) this.pendingAgent = null;
        this.cancelledAgentRuns.delete(runId);
      });
    this.pendingAgent = pending;
  }

  async waitForPendingAgent(): Promise<void> {
    if (this.pendingAgent) await this.pendingAgent;
  }

  watchCurrentWidget(): { close: () => void } | null {
    ensureRuntime(this.options.projectRoot);
    try {
      return watch(this.paths.outDir, { persistent: false }, (_event, fileName) => {
        if (fileName !== basename(this.paths.currentWidgetPath)) return;
        void this.tryLoadExternalWidget("watch.current-widget");
      });
    } catch {
      return null;
    }
  }

  startMacMicTranscriptSource(): TranscriptSource | null {
    const command = resolveMacMicSttCommand(this.options);
    if (!command) return null;
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolveDonePromise) => {
      resolveDone = resolveDonePromise;
    });
    const child = spawn(command, { shell: true, cwd: this.options.projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const text = line.trim();
        if (text) this.enqueueMicTranscript(text);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      void this.log({ event: "input.mic.stderr", chunk: cleanText(chunk, 200) });
    });
    child.on("error", (error: Error) => {
      void this.log({ event: "input.mic.error", message: error.message });
      resolveDone();
    });
    child.on("exit", (code, signal) => {
      void this.log({ event: "input.mic.exit", code, signal });
      resolveDone();
    });
    void this.log({ event: "input.mic.start", command });
    return {
      command,
      done,
      close: () => {
        if (child.exitCode === null) child.kill("SIGTERM");
      },
    };
  }

  async startHttpTranscriptSource(port: number): Promise<TranscriptSource> {
    const server = createServer((request, response) => {
      void this.handleHttpTranscriptRequest(request, response);
    });
    const done = new Promise<void>((resolveDone) => {
      server.on("close", resolveDone);
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    const url = "http://127.0.0.1:" + actualPort + "/";
    await this.log({ event: "input.http.start", port: actualPort, url });
    if (process.stdin.isTTY) process.stdout.write("Browser ASR page: " + url + "\n");
    return {
      command: "http:" + actualPort,
      done,
      close: () => server.close(),
    };
  }

  private enqueueMicTranscript(text: string): void {
    this.transcriptQueue = this.transcriptQueue
      .catch((error: unknown) => this.log({
        event: "input.transcript_queue_error",
        message: error instanceof Error ? error.message : String(error),
      }))
      .then(async () => {
        await this.log({ event: "input.mic.transcript", text: cleanText(text, 240) });
        const keepRunning = await this.handleTranscript(text, "voice");
        if (!keepRunning) {
          await this.log({ event: "input.mic.runtime_exit_requested", text: cleanText(text, 80) });
        }
      });
  }

  private async handleHttpTranscriptRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        sendHtml(response, browserAsrHtml());
        return;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        sendJson(response, { ok: true, state: this.currentState, hermesCli: Boolean(this.hermesCli) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/transcript") {
        const body = await readRequestBody(request, 4096);
        const parsed = body.trim().startsWith("{") ? JSON.parse(body) as unknown : { text: body };
        const text = isRecord(parsed) && typeof parsed.text === "string" ? cleanText(parsed.text, 240) : "";
        if (!text) {
          sendJson(response, { ok: false, error: "missing text" }, 400);
          return;
        }
        await this.log({ event: "input.http.transcript", text });
        this.enqueueMicTranscript(text);
        sendJson(response, { ok: true, text });
        return;
      }
      sendJson(response, { ok: false, error: "not found" }, 404);
    } catch (error) {
      sendJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  shutdown(): void {
    this.stopHermesCliProcess("runtime.shutdown");
  }

  private async handleHermesCliInput(text: string, lower: string, source: TranscriptInputSource): Promise<boolean> {
    if (source === "voice") {
      return this.handleHermesCliVoiceInput(text, lower);
    }
    if (lower === "exit" || lower === "quit") {
      await this.closeHermesCli("input.exit", true);
      await this.log({ event: "runtime.exit", reason: lower });
      return false;
    }
    if (isHermesCliCloseCommand(lower)) {
      await this.closeHermesCli(lower === "timeout" ? "input.timeout" : "input.dismiss", true);
      return true;
    }
    if (["hud", "hud status", "look_up", "lookup", "look up", "show agents"].includes(lower)) {
      await this.showAgentHud("hermes_cli.agent_hud");
      return true;
    }

    await this.sendHermesCliLine(text);
    return true;
  }

  private async handleHermesCliVoiceInput(text: string, lower: string): Promise<boolean> {
    const command = normalizeHermesVoiceCommandAlias(lower || normalizeVoiceControlCommand(text));
    const pendingCommand = consumeSplitHermesControlCommand(this.pendingVoiceControlPrefix, command);
    if (pendingCommand === "close") {
      this.pendingVoiceControlPrefix = null;
      await this.closeHermesCli("input.dismiss", true);
      return true;
    }
    if (isHermesClosePrefix(command)) {
      this.pendingVoiceControlPrefix = command;
      await this.log({ event: "input.voice_command.pending", command });
      return true;
    }
    this.pendingVoiceControlPrefix = null;

    if (command === "exit" || command === "quit") {
      await this.closeHermesCli("input.exit", true);
      await this.log({ event: "runtime.exit", reason: command });
      return false;
    }
    if (isHermesCliCloseCommand(command)) {
      await this.closeHermesCli(command === "timeout" ? "input.timeout" : "input.dismiss", true);
      return true;
    }
    if (["clear draft", "cancel draft", "reset draft", "discard draft"].includes(command)) {
      this.voiceDraft = "";
      this.lastVoiceDraftPiece = "";
      this.voicePromptArmed = false;
      this.removeVoiceDraftLine();
      this.pushTerminalLine("ASR: draft cleared.");
      await this.log({ event: "asr.voice_draft.clear" });
      await this.renderTerminal("asr.voice_draft.clear");
      return true;
    }
    if (isVoiceSendCommand(command)) {
      await this.submitVoiceDraft();
      return true;
    }
    if (["hud", "hud status", "look up", "lookup", "show agents"].includes(command)) {
      await this.showAgentHud("hermes_cli.agent_hud");
      return true;
    }

    const wake = splitHermesPromptWake(command);
    if (wake.wake) {
      this.voicePromptArmed = true;
      this.lastVoiceDraftPiece = "";
      await this.log({ event: "asr.voice_gate.open", text, prompt: wake.prompt });
      if (wake.prompt) {
        const trailingWakeSend = splitTrailingVoiceSend(wake.prompt);
        await this.appendVoiceDraft(trailingWakeSend.text || wake.prompt, "asr.voice_draft.update");
        if (trailingWakeSend.shouldSend) await this.submitVoiceDraft();
      } else {
        this.pushTerminalLine("ASR: listening.");
        await this.renderTerminal("asr.voice_gate.open");
      }
      return true;
    }

    const trailingSend = splitTrailingVoiceSend(text);
    if (trailingSend.shouldSend) {
      if (!this.voicePromptArmed && !this.voiceDraft) {
        await this.log({ event: "asr.voice_gate.ignored", text, reason: "send_without_wake" });
        return true;
      }
      if (trailingSend.text) {
        await this.appendVoiceDraft(trailingSend.text, "asr.voice_draft.update");
      }
      await this.submitVoiceDraft();
      return true;
    }

    if (!this.voicePromptArmed) {
      await this.log({ event: "asr.voice_gate.ignored", text, reason: "waiting_for_hermes" });
      return true;
    }

    await this.appendVoiceDraft(text, "asr.voice_draft.update");
    return true;
  }

  private async appendVoiceDraft(text: string, reason: string): Promise<void> {
    const piece = cleanText(text, 240);
    if (!piece || piece === this.lastVoiceDraftPiece) return;
    this.voiceDraft = mergeVoiceDraft(this.voiceDraft, piece, this.lastVoiceDraftPiece);
    this.lastVoiceDraftPiece = piece;
    this.setVoiceDraftLine();
    await this.log({ event: "asr.voice_draft.update", text: this.voiceDraft, piece });
    this.scheduleTerminalRender(reason);
  }

  private async submitVoiceDraft(): Promise<void> {
    const prompt = cleanText(this.voiceDraft, 900);
    if (!prompt) {
      this.pushTerminalLine("ASR: nothing to send yet.");
      await this.log({ event: "asr.voice_command.send_ignored", reason: "empty_draft" });
      await this.renderTerminal("asr.voice_command.empty_send");
      return;
    }
    this.voiceDraft = "";
    this.lastVoiceDraftPiece = "";
    this.voicePromptArmed = false;
    this.removeVoiceDraftLine();
    await this.log({ event: "asr.voice_command.send", text: prompt });
    await this.sendHermesCliLine(prompt);
  }

  private startRealHermesCli(hermesPath: string): void {
    const tmuxSession = normalizeTmuxSessionName(this.options.hermesTmuxSession || "");
    if (tmuxSession) {
      this.startTmuxHermesCli(hermesPath, tmuxSession);
      return;
    }
    const args = hermesCliArgs(this.options);
    const child = spawn(hermesPath, args, {
      cwd: this.options.projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PERIPHERAL_HUD_WIDGET_PATH: this.paths.currentWidgetPath },
    });
    if (!this.hermesCli) return;
    this.hermesCli.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.appendTerminalChunk("stdout", chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      this.appendTerminalChunk("stderr", chunk);
    });
    child.on("error", (error: Error) => {
      void this.handleHermesCliExit("error", error.message);
    });
    child.on("exit", (code) => {
      void this.handleHermesCliExit("exit", code === 0 ? "Hermes CLI exited." : "Hermes CLI exited " + code + ".");
    });
    this.primeChildHermesCli(child);
    void this.log({ event: "hermes_cli.start", mode: "real", command: [hermesPath, ...args].join(" ") });
  }

  private startTmuxHermesCli(hermesPath: string, sessionName: string): void {
    if (!this.hermesCli) return;
    const tmuxPath = resolveExecutablePath("tmux") || "tmux";
    spawnSync(tmuxPath, ["kill-session", "-t", sessionName], { encoding: "utf8", timeout: 2_000 });
    const args = hermesCliArgs(this.options);
    const command = [shellQuote(hermesPath), ...args.map((arg) => shellQuote(arg))].join(" ");
    const started = spawnSync(tmuxPath, ["new-session", "-d", "-s", sessionName, "-c", this.options.projectRoot, command], {
      encoding: "utf8",
      env: { ...process.env, PERIPHERAL_HUD_WIDGET_PATH: this.paths.currentWidgetPath },
      timeout: 5_000,
    });
    if (started.status !== 0) {
      const error = cleanText(started.stderr || started.stdout || "Unable to start tmux Hermes CLI.", 200);
      this.pushTerminalLine("HUD: tmux Hermes CLI failed: " + error);
      void this.log({ event: "hermes_cli.tmux_start_error", session: sessionName, message: error });
      void this.renderTerminal("hermes_cli.tmux_start_error");
      return;
    }

    this.hermesCli.tmuxSession = sessionName;
    this.hermesCli.tmuxPath = tmuxPath;
    this.hermesCli.tmuxCaptureTimer = null;
    this.hermesCli.tmuxLastSnapshot = "";
    this.hermesCli.tmuxOwnsSession = true;
    this.pushTerminalLine("HUD: Terminal is attached to Hermes session " + sessionName + ".");
    void this.log({
      event: "hermes_cli.start",
      mode: "real",
      transport: "tmux",
      session: sessionName,
      command,
    });
    if (this.options.openHermesTerminal) {
      this.openTerminalForTmux(tmuxPath, sessionName);
    }
    this.primeTmuxHermesCli(tmuxPath, sessionName);
    this.scheduleTmuxCapture(this.hermesCli, 200);
  }

  private primeTmuxHermesCli(tmuxPath: string, sessionName: string): void {
    const commands = hermesStartupCommands(this.options);
    if (!commands.length) return;
    setTimeout(() => {
      for (const command of commands) {
        spawnSync(tmuxPath, ["send-keys", "-t", sessionName, "C-u"], { encoding: "utf8", timeout: 2_000 });
        spawnSync(tmuxPath, ["send-keys", "-l", "-t", sessionName, command], { encoding: "utf8", timeout: 2_000 });
        spawnSync(tmuxPath, ["send-keys", "-t", sessionName, "C-m"], { encoding: "utf8", timeout: 2_000 });
      }
      void this.log({ event: "hermes_cli.prime", transport: "tmux", session: sessionName, commands });
      const session = this.hermesCli;
      if (session) this.scheduleTmuxCapture(session, 300);
    }, 7000);
  }

  private primeChildHermesCli(child: ChildProcessWithoutNullStreams): void {
    const commands = hermesStartupCommands(this.options);
    if (!commands.length) return;
    setTimeout(() => {
      if (!child.stdin.writable) return;
      for (const command of commands) child.stdin.write(command + "\n", "utf8");
      void this.log({ event: "hermes_cli.prime", transport: "stdio", commands });
    }, 1200);
  }

  private openTerminalForTmux(tmuxPath: string, sessionName: string): void {
    const attachCommand = shellQuote(tmuxPath) + " attach -t " + shellQuote(sessionName);
    const script = [
      "tell application \"Terminal\"",
      "activate",
      "do script " + JSON.stringify(attachCommand),
      "set bounds of front window to {40, 60, 1240, 860}",
      "end tell",
    ];
    const opened = spawnSync("osascript", script.flatMap((line) => ["-e", line]), {
      encoding: "utf8",
      timeout: 5_000,
    });
    void this.log({
      event: "hermes_cli.terminal_open",
      session: sessionName,
      ok: opened.status === 0,
      message: cleanText(opened.stderr || opened.stdout || "", 200),
    });
  }

  private async sendHermesCliLine(text: string): Promise<void> {
    const session = this.hermesCli;
    if (!session) return;
    await this.log({ event: "hermes_cli.input", mode: session.mode, text });
    this.pushTerminalLine("> " + text);

    if (session.mode === "mock") {
      await this.renderTerminal("hermes_cli.input");
      await delay(Math.min(this.cadenceMs, 900));
      if (!this.hermesCli) return;
      this.pushTerminalLine("Hermes(mock): received " + cleanText(text, 64));
      this.pushTerminalLine("Hermes(mock): interactive CLI display path is wired.");
      await this.log({ event: "hermes_cli.mock_response", text: "interactive CLI display path is wired." });
      await this.renderTerminal("hermes_cli.mock_response");
      return;
    }

    if (session.tmuxSession) {
      const tmuxPath = session.tmuxPath || resolveExecutablePath("tmux") || "tmux";
      const sentText = spawnSync(tmuxPath, ["send-keys", "-t", session.tmuxSession, "-l", text], { encoding: "utf8", timeout: 2_000 });
      const sentEnter = sentText.status === 0
        ? spawnSync(tmuxPath, ["send-keys", "-t", session.tmuxSession, "Enter"], { encoding: "utf8", timeout: 2_000 })
        : sentText;
      if (sentText.status !== 0 || sentEnter.status !== 0) {
        const error = cleanText(sentText.stderr || sentEnter.stderr || "tmux send failed.", 160);
        this.pushTerminalLine("HUD: Hermes tmux session is not writable: " + error);
        await this.log({ event: "hermes_cli.tmux_input_error", session: session.tmuxSession, message: error });
        await this.renderTerminal("hermes_cli.not_writable");
        return;
      }
      await this.log({ event: "hermes_cli.tmux_input", session: session.tmuxSession, text });
      this.scheduleTmuxCapture(session, 150);
      this.scheduleTerminalRender("hermes_cli.input");
      return;
    }

    const child = session.child;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      this.pushTerminalLine("HUD: Hermes CLI is not writable.");
      await this.renderTerminal("hermes_cli.not_writable");
      return;
    }
    child.stdin.write(text + "\n", "utf8");
    this.scheduleTerminalRender("hermes_cli.input");
  }

  private scheduleTmuxCapture(session: HermesCliSession, delayMs = Math.max(700, Math.min(this.cadenceMs, 1400))): void {
    if (!session.tmuxSession || session.tmuxCaptureTimer) return;
    session.tmuxCaptureTimer = setTimeout(() => {
      session.tmuxCaptureTimer = null;
      void this.captureTmuxHermesCli(session);
    }, delayMs);
  }

  private async captureTmuxHermesCli(session: HermesCliSession): Promise<void> {
    if (!this.hermesCli || this.hermesCli !== session || !session.tmuxSession) return;
    const tmuxPath = session.tmuxPath || resolveExecutablePath("tmux") || "tmux";
    const captured = spawnSync(tmuxPath, ["capture-pane", "-p", "-t", session.tmuxSession, "-S", "-80"], {
      encoding: "utf8",
      timeout: 2_000,
    });
    if (captured.status !== 0) {
      const message = cleanText(captured.stderr || captured.stdout || "Hermes tmux session ended.", 180);
      await this.handleHermesCliExit("exit", message || "Hermes tmux session ended.");
      return;
    }

    const snapshot = String(captured.stdout || "").replace(/\r/g, "\n");
    if (snapshot !== session.tmuxLastSnapshot) {
      session.tmuxLastSnapshot = snapshot;
      const lines = compactHermesTerminalLines(snapshot.split(/\n+/)).slice(-76);
      this.terminalLines = lines.length > 0 ? lines : ["Hermes CLI"];
      this.voiceDraftLineIndex = null;
      if (this.voiceDraft) this.setVoiceDraftLine();
      await this.log({ event: "hermes_cli.tmux_capture", session: session.tmuxSession, lines: lines.length });
      this.scheduleTerminalRender("hermes_cli.tmux_capture");
    }
    this.scheduleTmuxCapture(session);
  }

  private appendTerminalChunk(stream: "stdout" | "stderr", chunk: string): void {
    const clean = stripAnsi(chunk).replace(/\r/g, "\n");
    for (const rawLine of clean.split(/\n+/)) {
      const line = cleanTerminalLine(rawLine);
      if (!line) continue;
      this.pushTerminalLine(stream === "stderr" ? "err: " + line : line);
      void this.log({ event: "hermes_cli.output", stream, line: cleanText(line, 160) });
    }
    this.scheduleTerminalRender("hermes_cli." + stream);
  }

  private async handleHermesCliExit(kind: "exit" | "error", message: string): Promise<void> {
    if (!this.hermesCli) return;
    this.pushTerminalLine("HUD: " + message);
    const elapsedMs = roundMs(performance.now() - this.hermesCli.startedAt);
    const status: AgentStatus = kind === "exit" ? "completed" : "error";
    await this.log({ event: "hermes_cli." + kind, message, elapsedMs });
    await this.updateAgentStatus("Hermes", status, message);
    await this.renderTerminal("hermes_cli." + kind);
  }

  private async closeHermesCli(reason: string, blank: boolean): Promise<void> {
    if (!this.hermesCli) {
      if (blank) await this.clear(reason);
      return;
    }
    this.pushTerminalLine("HUD: closing Hermes CLI.");
    this.stopHermesCliProcess(reason);
    await this.updateAgentStatus("Hermes", "completed", "Hermes CLI closed.");
    await this.log({ event: "hermes_cli.close", reason });
    if (blank) {
      await this.setState("blank", { reason });
      await this.clearCurrentWidget(reason);
      await this.blankDisplay(reason);
    }
  }

  private stopHermesCliProcess(reason: string): void {
    const session = this.hermesCli;
    if (!session) return;
    this.hermesCli = null;
    this.voiceDraft = "";
    this.voiceDraftLineIndex = null;
    this.lastVoiceDraftPiece = "";
    this.pendingVoiceControlPrefix = null;
    this.voicePromptArmed = false;
    if (this.terminalRenderTimer) {
      clearTimeout(this.terminalRenderTimer);
      this.terminalRenderTimer = null;
    }
    if (session.tmuxCaptureTimer) {
      clearTimeout(session.tmuxCaptureTimer);
      session.tmuxCaptureTimer = null;
    }
    if (session.child && session.child.exitCode === null) {
      session.child.kill("SIGTERM");
    }
    if (session.tmuxSession && session.tmuxOwnsSession) {
      const tmuxPath = session.tmuxPath || resolveExecutablePath("tmux") || "tmux";
      spawnSync(tmuxPath, ["kill-session", "-t", session.tmuxSession], { encoding: "utf8", timeout: 2_000 });
    }
    void this.log({ event: "hermes_cli.stop", reason, mode: session.mode, session: session.tmuxSession });
  }

  private pushTerminalLine(line: string): void {
    const clean = cleanTerminalLine(line);
    if (!clean) return;
    this.terminalLines.push(clean);
    this.trimTerminalLines();
  }

  private setVoiceDraftLine(): void {
    this.removeVoiceDraftLine();
    const draft = this.voiceDraft ? this.voiceDraft : "(empty)";
    this.terminalLines.push("ASR draft: " + draft);
    this.voiceDraftLineIndex = this.terminalLines.length - 1;
    this.trimTerminalLines();
  }

  private removeVoiceDraftLine(): void {
    if (this.voiceDraftLineIndex === null) return;
    if (this.terminalLines[this.voiceDraftLineIndex]?.startsWith("ASR draft:")) {
      this.terminalLines.splice(this.voiceDraftLineIndex, 1);
    }
    this.voiceDraftLineIndex = null;
  }

  private trimTerminalLines(): void {
    if (this.terminalLines.length > 80) {
      const removed = this.terminalLines.length - 80;
      this.terminalLines.splice(0, removed);
      if (this.voiceDraftLineIndex !== null) {
        this.voiceDraftLineIndex = this.voiceDraftLineIndex < removed ? null : this.voiceDraftLineIndex - removed;
      }
    }
  }

  private scheduleTerminalRender(reason: string): void {
    if (!this.hermesCli || this.terminalRenderTimer) return;
    this.terminalRenderTimer = setTimeout(() => {
      this.terminalRenderTimer = null;
      if (!this.hermesCli) return;
      if (this.terminalRenderInFlight) {
        this.scheduleTerminalRender(reason);
        return;
      }
      this.terminalRenderInFlight = this.renderTerminal(reason).finally(() => {
        this.terminalRenderInFlight = null;
      });
    }, Math.max(350, Math.min(this.cadenceMs, 1200)));
  }

  private async renderTerminal(reason: string): Promise<Record<string, unknown>> {
    const mode = this.hermesCli?.mode || "mock";
    const widget = terminalWidget(mode, this.terminalLines);
    if (this.currentState !== "terminal") {
      await this.setState("terminal", { agent: "Hermes", reason, mode });
    }
    return this.renderPush(widget, reason);
  }

  private async runHermes(task: string, runId: number): Promise<void> {
    const detected = detectHermes();
    const mode = resolveHermesMode(this.options, detected.installed);
    await this.updateAgentStatus("Hermes", "launching", mode === "real" ? "Launching Hermes." : "Mock Hermes launch.");
    if (await this.suppressCancelledRun(runId, "hermes.launch.cancelled")) return;
    await this.setState("active_agent", { agent: "Hermes", task, mode });
    await this.renderPush(activeAgentWidget("Hermes", "launching", ["Task: " + task, mode === "real" ? "Launching Hermes." : "Using mock adapter."]), "hermes.launching");

    if (mode === "real" && detected.installed && detected.path) {
      await this.runRealHermes(task, detected.path, runId);
      return;
    }

    await this.runMockHermes(task, detected.installed, runId);
  }

  private async runMockHermes(task: string, hermesInstalled: boolean, runId: number): Promise<void> {
    await delay(this.cadenceMs);
    if (await this.suppressCancelledRun(runId, "hermes.mock.before_running")) {
      await this.updateAgentStatus("Hermes", "completed", "Mock result suppressed after display dismiss.");
      return;
    }
    await this.updateAgentStatus("Hermes", "running", hermesInstalled ? "Mocking result for safe display test." : "Hermes not installed; mock adapter active.");
    await this.renderPush(activeAgentWidget("Hermes", "running", ["Thinking in compact chunks.", "No token streaming to glasses.", "Task: " + task]), "hermes.mock.running");
    await delay(this.cadenceMs);
    if (await this.suppressCancelledRun(runId, "hermes.mock.before_result")) {
      await this.updateAgentStatus("Hermes", "completed", "Mock result suppressed after display dismiss.");
      return;
    }

    const widget = mockHermesResultWidget(task, hermesInstalled);
    await this.writeOwnedCurrentWidget(widget);
    await this.updateAgentStatus("Hermes", "completed", "Result widget emitted.");
    await this.setState("dynamic_result", { agent: "Hermes", source: this.paths.currentWidgetPath });
    await this.renderPush(widget, "hermes.mock.result");
  }

  private async runRealHermes(task: string, hermesPath: string, runId: number): Promise<void> {
    await this.updateAgentStatus("Hermes", "running", "Hermes process active.");
    if (await this.suppressCancelledRun(runId, "hermes.real.before_running_card")) return;
    await this.renderPush(activeAgentWidget("Hermes", "running", ["Hermes process active.", "Waiting for semantic HUD JSON.", "Updates are paced."]), "hermes.real.running");

    const prompt = hermesPrompt(task);
    const started = performance.now();
    const startedWallMs = Date.now();
    const child = spawn(hermesPath, ["-z", prompt], {
      cwd: this.options.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PERIPHERAL_HUD_WIDGET_PATH: this.paths.currentWidgetPath },
    });

    let stdout = "";
    let stderr = "";
    let latestChunk = "Hermes is working.";
    let tickInFlight: Promise<void> | null = null;
    const interval = setInterval(() => {
      if (this.isAgentRunCancelled(runId)) return;
      if (tickInFlight) return;
      tickInFlight = this.renderPush(activeAgentWidget("Hermes", "running", [latestChunk, "Waiting for final widget JSON."]), "hermes.real.tick")
        .catch((error: unknown) => this.log({ event: "hermes.real.tick_error", message: error instanceof Error ? error.message : String(error) }))
        .then(() => {
          tickInFlight = null;
        });
    }, this.cadenceMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      latestChunk = compactCliChunk(chunk);
      void this.log({ event: "agent.output", agent: "Hermes", stream: "stdout", chunk: latestChunk });
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      const clean = compactCliChunk(chunk);
      if (clean) latestChunk = clean;
      void this.log({ event: "agent.output", agent: "Hermes", stream: "stderr", chunk: clean });
    });

    const code = await new Promise<number | null>((resolveExit) => child.on("exit", (exitCode) => resolveExit(exitCode)));
    clearInterval(interval);
    if (tickInFlight) await tickInFlight;
    await this.log({ event: "agent.exit", agent: "Hermes", code, elapsedMs: roundMs(performance.now() - started) });
    if (this.isAgentRunCancelled(runId)) {
      await this.updateAgentStatus("Hermes", code === 0 ? "completed" : "error", code === 0 ? "Hermes completed after display dismiss." : "Hermes exited after display dismiss.");
      await this.log({ event: "agent.result.suppressed", agent: "Hermes", runId, code, reason: "display_cancelled" });
      return;
    }

    const externalWidget = this.readFreshCurrentWidget(startedWallMs);
    const widget = externalWidget || parseHermesWidget(stdout) || genericHermesOutputWidget(task, stdout, stderr, code);
    if (!externalWidget) {
      await this.writeOwnedCurrentWidget(widget);
    }
    const completed = Boolean(externalWidget) || code === 0;
    await this.updateAgentStatus("Hermes", completed ? "completed" : "error", completed ? "Hermes completed." : "Hermes exited " + code + ".");
    await this.setState(completed ? "dynamic_result" : "error", { agent: "Hermes", code, source: this.paths.currentWidgetPath });
    await this.renderPush(widget, completed ? "hermes.real.result" : "hermes.real.error");
  }

  private async updateAgentStatus(name: string, status: AgentStatus, summary: string): Promise<void> {
    const detected = name.toLowerCase() === "hermes" ? detectHermes() : { installed: undefined, path: undefined };
    this.agents = upsertAgent(this.agents.length ? this.agents : await buildAgentRegistry(this.options.projectRoot), {
      name,
      status,
      summary,
      installed: detected.installed,
      path: detected.path,
      updatedAt: new Date().toISOString(),
    });
    await writeFile(this.paths.agentStatusPath, JSON.stringify(this.agents, null, 2) + "\n", "utf8");
    await this.log({ event: "agent.status", agent: name, status, summary });
  }

  private async tryLoadExternalWidget(reason: string): Promise<void> {
    try {
      if (!existsSync(this.paths.currentWidgetPath)) return;
      const stat = statSync(this.paths.currentWidgetPath);
      if (stat.mtimeMs <= this.lastWidgetMtime) return;
      this.lastWidgetMtime = stat.mtimeMs;
      const widget = assertWidget(JSON.parse(readFileSync(this.paths.currentWidgetPath, "utf8")) as unknown);
      if (JSON.stringify(widget) === this.lastWidgetJson) return;
      await this.setState("dynamic_result", { reason, source: this.paths.currentWidgetPath });
      await this.renderPush(widget, reason);
    } catch (error) {
      await this.log({ event: "watch.current-widget.error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private readFreshCurrentWidget(sinceEpochMs: number): PeripheralWidget | null {
    try {
      if (!existsSync(this.paths.currentWidgetPath)) return null;
      const stat = statSync(this.paths.currentWidgetPath);
      if (stat.mtimeMs + 1 < sinceEpochMs) return null;
      const widget = assertWidget(JSON.parse(readFileSync(this.paths.currentWidgetPath, "utf8")) as unknown);
      this.lastWidget = widget;
      this.lastWidgetJson = JSON.stringify(widget);
      this.lastWidgetMtime = stat.mtimeMs;
      return widget;
    } catch (error) {
      void this.log({ event: "current_widget.read_error", message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  private async renderPush(widget: PeripheralWidget, reason: string): Promise<Record<string, unknown>> {
    this.lastWidget = assertWidget(widget);
    this.lastWidgetJson = JSON.stringify(this.lastWidget);
    return renderPushAndLog(this.lastWidget, this.options, this.driverOptions, this.logPath, reason);
  }

  private async writeOwnedCurrentWidget(widget: PeripheralWidget): Promise<void> {
    const valid = assertWidget(widget);
    this.lastWidget = valid;
    this.lastWidgetJson = JSON.stringify(valid);
    await writeFile(this.paths.currentWidgetPath, JSON.stringify(valid, null, 2) + "\n", "utf8");
    try {
      this.lastWidgetMtime = statSync(this.paths.currentWidgetPath).mtimeMs;
    } catch {
      this.lastWidgetMtime = Date.now();
    }
  }

  private nextAgentRunId(): number {
    this.activeAgentRunId += 1;
    return this.activeAgentRunId;
  }

  private cancelActiveAgentDisplay(reason: string): void {
    if (!this.pendingAgent) return;
    const runId = this.activeAgentRunId;
    this.cancelledAgentRuns.add(runId);
    void this.log({ event: "agent.run.display_cancelled", agent: "Hermes", runId, reason });
  }

  private isAgentRunCancelled(runId: number): boolean {
    return this.cancelledAgentRuns.has(runId);
  }

  private async suppressCancelledRun(runId: number, reason: string): Promise<boolean> {
    if (!this.isAgentRunCancelled(runId)) return false;
    await this.log({ event: "agent.run.suppressed", agent: "Hermes", runId, reason });
    return true;
  }

  private async handleAgentRunError(runId: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.updateAgentStatus("Hermes", "error", message);
    if (await this.suppressCancelledRun(runId, "hermes.error_after_display_cancel")) return;
    await this.showError("Hermes failed: " + message);
  }
}

function ensureRuntime(projectRoot: string): RuntimePaths {
  const paths = runtimePaths(projectRoot);
  mkdirSync(paths.outDir, { recursive: true });
  return paths;
}

function runtimeDriverOptions(options: HudRuntimeOptions, logPath: string): DriverOptions {
  return {
    projectRoot: options.projectRoot,
    repoRoot: options.repoRoot || resolve(options.projectRoot, ".."),
    mock: options.displayMode !== "real",
    dryRun: false,
    logPath,
  };
}

async function renderPushAndLog(
  widget: PeripheralWidget,
  options: HudRuntimeOptions,
  driverOptions: DriverOptions,
  logPath: string,
  reason: string,
): Promise<Record<string, unknown>> {
  const valid = assertWidget(widget);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(options.projectRoot, "out", "frames", "runtime", stamp + "-" + safeName(valid.type) + "-" + safeName(valid.id) + ".png");
  const renderStart = performance.now();
  const artifact = renderWidgetToFile(valid, outPath, { assetRoot: join(options.projectRoot, "fixtures", "images") });
  const renderMs = roundMs(performance.now() - renderStart);
  const pushStart = performance.now();
  const push = await pushArtifact(artifact, driverOptions);
  const pushMs = roundMs(performance.now() - pushStart);
  await appendJsonl(logPath, {
    event: "display.frame",
    reason,
    stateWidgetType: valid.type,
    widgetId: valid.id,
    renderMs,
    pushMs,
    artifact: { pngPath: artifact.pngPath, sidecarPath: artifact.sidecarPath, width: artifact.width, height: artifact.height, stats: artifact.stats },
    push,
  });
  return { artifact, push, renderMs, pushMs, logPath };
}

async function writeState(paths: RuntimePaths, state: HudRuntimeState, extra: Record<string, unknown>): Promise<void> {
  await writeFile(paths.statePath, JSON.stringify({ state, updatedAt: new Date().toISOString(), ...extra }, null, 2) + "\n", "utf8");
}

async function writeStateAndLog(paths: RuntimePaths, logPath: string, state: HudRuntimeState, extra: Record<string, unknown>): Promise<void> {
  await writeState(paths, state, extra);
  await appendJsonl(logPath, { event: "state.change", state, ...extra });
}

async function clearCurrentWidgetFile(paths: RuntimePaths, logPath: string, reason: string): Promise<void> {
  if (!existsSync(paths.currentWidgetPath)) return;
  try {
    await unlink(paths.currentWidgetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return;
  }
  await appendJsonl(logPath, { event: "current_widget.clear", reason, path: paths.currentWidgetPath });
}

function readJsonIfExists(path: string): unknown | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

async function buildAgentRegistry(projectRoot: string, options: { includeCache?: boolean } = {}): Promise<AgentRecord[]> {
  const configured = readAgentConfig(projectRoot);
  const cached = options.includeCache === false ? [] : readAgentStatusCache(projectRoot);
  const hermes = detectHermes();
  const now = new Date().toISOString();
  const base: AgentRecord[] = [
    {
      name: "Hermes",
      status: hermes.installed ? "idle" : "error",
      summary: hermes.installed ? "Installed and ready." : "Not installed; mock adapter available.",
      command: "hermes",
      installed: hermes.installed,
      path: hermes.path,
      real: hermes.installed,
      updatedAt: now,
    },
    { name: "Codex", status: "idle", summary: "Static registry entry for future adapter.", installed: true, real: false, updatedAt: now },
    { name: "Claude", status: "idle", summary: "Static registry entry for future adapter.", installed: false, real: false, updatedAt: now },
    { name: "OpenCode", status: "idle", summary: "Static registry entry for future adapter.", installed: false, real: false, updatedAt: now },
  ];
  const withConfig = configured.length ? mergeConfiguredAgents(base, configured) : base;
  return cached.length ? mergeConfiguredAgents(withConfig, cached) : withConfig;
}

function readAgentConfig(projectRoot: string): Partial<AgentRecord>[] {
  const configPath = join(projectRoot, "config", "agents.json");
  if (!existsSync(configPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed as Partial<AgentRecord>[] : [];
  } catch {
    return [];
  }
}

function readAgentStatusCache(projectRoot: string): Partial<AgentRecord>[] {
  const cachePath = runtimePaths(projectRoot).agentStatusPath;
  if (!existsSync(cachePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed as Partial<AgentRecord>[] : [];
  } catch {
    return [];
  }
}

function mergeConfiguredAgents(base: AgentRecord[], configured: Partial<AgentRecord>[]): AgentRecord[] {
  let next = [...base];
  for (const item of configured) {
    if (!item.name) continue;
    next = upsertAgent(next, {
      ...item,
      name: item.name,
      status: isAgentStatus(item.status) ? item.status : "idle",
      updatedAt: item.updatedAt || new Date().toISOString(),
    });
  }
  return next;
}

function upsertAgent(agents: AgentRecord[], patch: Partial<AgentRecord> & { name: string; status?: AgentStatus; updatedAt?: string }): AgentRecord[] {
  const name = normalizeAgentName(patch.name);
  const existing = agents.find((agent) => agent.name.toLowerCase() === name.toLowerCase());
  const next: AgentRecord = {
    ...(existing || { name, status: "idle" as AgentStatus, updatedAt: new Date().toISOString() }),
    ...patch,
    name,
    status: patch.status || existing?.status || "idle",
    updatedAt: patch.updatedAt || new Date().toISOString(),
  };
  return [...agents.filter((agent) => agent.name.toLowerCase() !== name.toLowerCase()), next]
    .sort((a, b) => agentSortKey(a.name) - agentSortKey(b.name));
}

async function waitForTranscriptSources(sources: TranscriptSource[], durationSeconds?: number): Promise<void> {
  if (durationSeconds !== undefined) {
    await delay(Math.max(0.1, durationSeconds) * 1000);
    return;
  }
  await Promise.all(sources.map((source) => source.done));
}

function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        rejectBody(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", rejectBody);
  });
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(value));
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function browserAsrHtml(): string {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "  <title>Peripheral ASR</title>",
    "  <style>",
    "    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",
    "    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #050706; color: #eafff3; }",
    "    main { width: min(720px, calc(100vw - 32px)); display: grid; gap: 18px; }",
    "    h1 { margin: 0; font-size: 22px; font-weight: 650; }",
    "    p { margin: 0; color: #a8c9b7; }",
    "    button { width: fit-content; border: 1px solid #94ffd0; background: #94ffd0; color: #062015; padding: 10px 16px; font: inherit; border-radius: 6px; cursor: pointer; }",
    "    button.secondary { background: transparent; color: #eafff3; }",
    "    .row { display: flex; gap: 10px; flex-wrap: wrap; }",
    "    #status { color: #94ffd0; min-height: 22px; }",
    "    #log { min-height: 180px; border: 1px solid rgba(234,255,243,.24); border-radius: 6px; padding: 12px; white-space: pre-wrap; background: rgba(255,255,255,.04); }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <h1>Peripheral ASR</h1>",
    "    <p>Speak into this Mac. Final transcripts update the Hermes CLI draft; say send to submit.</p>",
    "    <div class=\"row\"><button id=\"start\">Start</button><button id=\"stop\" class=\"secondary\">Stop</button></div>",
    "    <div id=\"status\">idle</div>",
    "    <div id=\"log\"></div>",
    "  </main>",
    "  <script>",
    "    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;",
    "    const statusEl = document.getElementById('status');",
    "    const logEl = document.getElementById('log');",
    "    let recognition;",
    "    function log(line) { logEl.textContent = (new Date()).toLocaleTimeString() + '  ' + line + '\\n' + logEl.textContent; }",
    "    async function send(text) {",
    "      const clean = text.trim();",
    "      if (!clean) return;",
    "      log('> ' + clean);",
    "      await fetch('/transcript', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: clean }) });",
    "    }",
    "    document.getElementById('start').onclick = () => {",
    "      if (!Recognition) { statusEl.textContent = 'SpeechRecognition is not available in this browser.'; return; }",
    "      recognition = new Recognition();",
    "      recognition.continuous = true;",
    "      recognition.interimResults = true;",
    "      recognition.lang = 'en-US';",
    "      recognition.onstart = () => { statusEl.textContent = 'listening'; log('listening'); };",
    "      recognition.onerror = (event) => { statusEl.textContent = 'error: ' + event.error; log('error: ' + event.error); };",
    "      recognition.onend = () => { statusEl.textContent = 'stopped'; log('stopped'); };",
    "      recognition.onresult = (event) => {",
    "        for (let index = event.resultIndex; index < event.results.length; index += 1) {",
    "          const result = event.results[index];",
    "          if (result.isFinal) send(result[0].transcript);",
    "        }",
    "      };",
    "      recognition.start();",
    "    };",
    "    document.getElementById('stop').onclick = () => recognition && recognition.stop();",
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
}

function detectHermes(): { installed: boolean; path: string | null } {
  const direct = spawnSync("which", ["hermes"], { encoding: "utf8" });
  const path = direct.status === 0 ? direct.stdout.trim().split(/\r?\n/)[0] || null : null;
  return { installed: Boolean(path), path };
}

function resolveMacMicSttCommand(options: HudRuntimeOptions): string | null {
  if (options.sttCommand) return options.sttCommand;
  if (process.env.PERIPHERAL_HUD_STT_CMD) return process.env.PERIPHERAL_HUD_STT_CMD;
  const asrProvider = options.asrProvider || "auto";
  const openaiCommand = resolveOpenAiRealtimeSttCommand(options);
  if (asrProvider === "openai-realtime") return openaiCommand;
  if (asrProvider === "auto" && openaiCommand && openAiKeyLooksConfigured(options)) return openaiCommand;
  if (asrProvider !== "auto" && asrProvider !== "macos-speech") return null;
  if (process.platform !== "darwin") return null;

  const appPath = join(options.projectRoot, "tools", "bin", "PeripheralMacASR.app");
  const appBinaryPath = join(appPath, "Contents", "MacOS", "peripheral-mac-asr");
  const binaryPath = join(options.projectRoot, "tools", "bin", "peripheral-mac-asr");
  const sourcePath = join(options.projectRoot, "tools", "macos-speech-asr", "MacSpeechAsr.swift");
  const args = [
    "--line-mode",
    "--locale",
    shellQuote(options.asrLocale || "en-US"),
    "--silence-ms",
    String(Math.max(300, options.asrSilenceMs || 1100)),
  ];
  if (options.asrDurationSeconds !== undefined) {
    args.push("--duration-seconds", String(Math.max(0.1, options.asrDurationSeconds)));
  }
  if (options.asrPartials) args.push("--partials");

  if (existsSync(appBinaryPath)) {
    return launchServicesAsrCommand(appPath, args, options.asrDurationSeconds);
  }

  const runner = existsSync(binaryPath)
    ? shellQuote(binaryPath)
    : existsSync(sourcePath)
      ? "swift " + shellQuote(sourcePath)
      : null;
  if (!runner) return null;

  return [runner, ...args].join(" ");
}

function resolveOpenAiRealtimeSttCommand(options: HudRuntimeOptions): string | null {
  const helperPath = join(options.projectRoot, "tools", "openai-realtime-asr.mjs");
  if (!existsSync(helperPath)) return null;
  const model = options.openaiAsrModel || process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || process.env.OPENAI_PERIPHERAL_ASR_MODEL || "gpt-realtime-whisper";
  const protocol = options.openaiAsrProtocol || process.env.OPENAI_REALTIME_ASR_PROTOCOL || "auto";
  const args = [
    shellQuote(helperPath),
    "--line-mode",
    "--model",
    shellQuote(model),
    "--protocol",
    shellQuote(protocol),
    "--commit-ms",
    String(Math.max(300, options.asrSilenceMs || 1200)),
  ];
  const envFile = resolveOpenAiEnvFile(options);
  if (envFile) args.push("--env-file", shellQuote(envFile));
  const language = openAiAsrLanguage(options);
  if (language) args.push("--language", shellQuote(language));
  const prompt = openAiAsrPrompt(model, protocol);
  if (prompt) args.push("--prompt", shellQuote(prompt));
  if (options.openaiAsrFfmpegInput) args.push("--ffmpeg-input", shellQuote(options.openaiAsrFfmpegInput));
  if (options.asrDurationSeconds !== undefined) {
    args.push("--duration-seconds", String(Math.max(0.1, options.asrDurationSeconds)));
  }
  if (options.asrPartials) args.push("--partials");
  return ["node", ...args].join(" ");
}

function resolveOpenAiEnvFile(options: HudRuntimeOptions): string | null {
  const candidates = [
    options.openaiEnvFile,
    process.env.OPENAI_ENV_FILE,
    join(options.projectRoot, ".env"),
    options.repoRoot ? join(options.repoRoot, ".env") : null,
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const path = resolve(candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

function openAiKeyLooksConfigured(options: HudRuntimeOptions): boolean {
  if (process.env.OPENAI_API_KEY) return true;
  const envFile = resolveOpenAiEnvFile(options);
  if (!envFile) return false;
  try {
    return /^OPENAI_API_KEY=/m.test(readFileSync(envFile, "utf8"));
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function launchServicesAsrCommand(appPath: string, args: string[], durationSeconds?: number): string {
  const app = shellQuote(appPath);
  const appBinary = shellQuote(join(appPath, "Contents", "MacOS", "peripheral-mac-asr"));
  const argString = args.join(" ");
  const watchdogSeconds = durationSeconds === undefined ? null : Math.ceil(Math.max(1, durationSeconds + 8));
  const commands = [
    "fifo=$(mktemp -u /tmp/peripheral-mac-asr.XXXXXX)",
    "app_binary=" + appBinary,
    "mkfifo \"$fifo\"",
    "cleanup(){ kill \"${open_pid:-}\" \"${cat_pid:-}\" \"${watchdog_pid:-}\" 2>/dev/null || true; pkill -f \"$app_binary\" 2>/dev/null || true; rm -f \"$fifo\"; }",
    "trap cleanup EXIT INT TERM",
    "cat \"$fifo\" & cat_pid=$!",
    "open -n -W " + app + " --args " + argString + " --out-file \"$fifo\" & open_pid=$!",
  ];
  if (watchdogSeconds !== null) {
    commands.push("( sleep " + watchdogSeconds + "; kill \"$open_pid\" \"$cat_pid\" 2>/dev/null || true; pkill -f \"$app_binary\" 2>/dev/null || true ) & watchdog_pid=$!");
  }
  commands.push(
    "wait \"$open_pid\"",
    "status=$?",
    "wait \"$cat_pid\" 2>/dev/null || true",
    "exit \"$status\"",
  );
  return commands.join("; ");
}

function resolveHermesMode(options: HudRuntimeOptions, hermesInstalled: boolean): "mock" | "real" {
  if (options.hermesMode === "mock") return "mock";
  if (options.hermesMode === "real") return hermesInstalled ? "real" : "mock";
  return options.displayMode === "real" && hermesInstalled ? "real" : "mock";
}

function isHermesCliCommand(lower: string): boolean {
  return [
    "cli",
    "terminal",
    "hermes cli",
    "hermes terminal",
    "open hermes",
    "open hermes cli",
    "start hermes",
    "show hermes",
    "show hermes cli",
  ].includes(lower);
}

function normalizeHermesVoiceCommandAlias(command: string): string {
  const mapped = new Map<string, string>([
    ["pinot noir", "open hermes"],
    ["pino noir", "open hermes"],
    ["finn hermes", "open hermes"],
    ["fin hermes", "open hermes"],
    ["open her mes", "open hermes"],
    ["open hermez", "open hermes"],
    ["open hermings", "open hermes"],
    ["open armies", "open hermes"],
    ["open ermes", "open hermes"],
    ["open hear me", "open hermes"],
    ["open here me", "open hermes"],
    ["close her mes", "close hermes"],
    ["close hermez", "close hermes"],
    ["close hermings", "close hermes"],
    ["close armies", "close hermes"],
    ["close ermes", "close hermes"],
    ["close hear me", "close hermes"],
    ["close here me", "close hermes"],
    ["close termites", "close hermes"],
    ["hear me", "hermes"],
    ["here me", "hermes"],
    ["termites", "hermes"],
  ]).get(command);
  if (mapped) return mapped;

  const words = command.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && (isHermesOpenPrefix(words[0]!) || isHermesClosePrefix(words[0]!)) && isHermesNameLike(words.slice(1).join(" "))) {
    return words[0] + " hermes";
  }
  if (isHermesNameLike(command)) return "hermes";
  return command;
}

function isHermesNameLike(value: string): boolean {
  const clean = normalizeVoiceControlCommand(value);
  return clean === "hermes" ||
    clean === "her mes" ||
    clean === "hear me" ||
    clean === "here me" ||
    clean === "termites" ||
    /^herm(?:es|ez|ing|ings|is)?$/.test(clean);
}

function isHermesCliCloseCommand(lower: string): boolean {
  return [
    "exit cli",
    "close cli",
    "close hermes",
    "close hermes cli",
    "dismiss",
    "dismiss hermes",
    "clear",
    "clear hermes",
    "hide hermes",
    "timeout",
  ].includes(lower);
}

function isHermesOpenPrefix(value: string): boolean {
  return ["open", "start", "show", "finn", "fin"].includes(value);
}

function isHermesClosePrefix(value: string): boolean {
  return ["close", "dismiss", "hide", "clear"].includes(value);
}

function consumeSplitHermesControlCommand(prefix: string | null, value: string): "open" | "close" | null {
  if (value !== "hermes" || !prefix) return null;
  if (isHermesOpenPrefix(prefix)) return "open";
  if (isHermesClosePrefix(prefix)) return "close";
  return null;
}

function agentHudWidget(agents: AgentRecord[]): PeripheralWidget {
  return {
    id: "agent-hud",
    type: "checklist",
    title: "Agent HUD",
    status: "LOOK UP",
    items: agents.slice(0, 5).map((agent) => ({
      label: agent.name + ": " + (agent.summary || agent.status),
      checked: agent.status === "idle" || agent.status === "completed",
      status: agent.status,
    })),
    footer: "SAY HERMES CLI OR HERMES <TASK>",
    created_at: new Date().toISOString(),
  };
}

function terminalWidget(mode: "mock" | "real", lines: string[]): PeripheralWidget {
  return {
    id: "hermes-cli",
    type: "terminal",
    title: "Hermes CLI",
    status: mode === "real" ? "native" : "mock",
    terminal: lines,
    prompt: "TYPE TO HERMES / EXIT CLI",
    created_at: new Date().toISOString(),
  };
}

function hermesCliArgs(options: HudRuntimeOptions): string[] {
  const args = ["chat", "--source", "peripheral-hud"];
  const model = hermesModel(options);
  if (model) args.push("--model", model);
  return args;
}

function hermesStartupCommands(options: HudRuntimeOptions): string[] {
  const commands: string[] = [];
  const reasoningEffort = hermesReasoningEffort(options);
  if (reasoningEffort) commands.push("/reasoning " + reasoningEffort);
  if (hermesFastMode(options)) commands.push("/fast fast");
  return commands;
}

function hermesModel(options: HudRuntimeOptions): string {
  return cleanText(options.hermesModel || process.env.PERIPHERAL_HUD_HERMES_MODEL || "gpt-5.5", 80);
}

function hermesReasoningEffort(options: HudRuntimeOptions): string {
  const value = cleanText(options.hermesReasoningEffort || process.env.PERIPHERAL_HUD_HERMES_REASONING || "low", 24).toLowerCase();
  return ["none", "minimal", "low", "medium", "high", "xhigh"].includes(value) ? value : "low";
}

function hermesFastMode(options: HudRuntimeOptions): boolean {
  if (options.hermesFastMode !== undefined) return options.hermesFastMode;
  const value = String(process.env.PERIPHERAL_HUD_HERMES_FAST || "1").trim().toLowerCase();
  return !["0", "false", "no", "normal", "off"].includes(value);
}

function openAiAsrLanguage(options: HudRuntimeOptions): string {
  const raw = cleanText(options.asrLocale || process.env.OPENAI_REALTIME_ASR_LANGUAGE || "en", 16);
  if (!raw || ["none", "off", "false", "0"].includes(raw.toLowerCase())) return "";
  return raw;
}

function openAiAsrPrompt(model: string, protocol: string): string {
  if ((protocol === "auto" || protocol === "legacy") && model.startsWith("gpt-realtime-")) return "";
  return cleanText(process.env.OPENAI_REALTIME_ASR_PROMPT || [
    "Transcribe English speech for a glasses HUD.",
    "Important voice commands are: open Hermes, close Hermes, send, clear draft, status, look up.",
    "Prefer the spelling Hermes for the agent name.",
  ].join(" "), 600);
}

function activeAgentWidget(agent: string, status: AgentStatus, chunks: string[]): PeripheralWidget {
  return {
    id: safeName(agent) + "-active",
    type: "generic_card",
    title: agent + " Active",
    status,
    body: chunks[0] || "Running.",
    bullets: chunks.slice(1, 5),
    footer: "SUBTITLE CADENCE",
    created_at: new Date().toISOString(),
  };
}

function errorWidget(message: string): PeripheralWidget {
  return {
    id: "hud-error",
    type: "generic_card",
    title: "HUD Error",
    status: "error",
    body: cleanText(message, 220),
    footer: "SAY DISMISS",
    created_at: new Date().toISOString(),
  };
}

function mockHermesResultWidget(task: string, hermesInstalled: boolean): PeripheralWidget {
  return {
    id: "hermes-result",
    type: "generic_card",
    title: "Hermes Result",
    status: hermesInstalled ? "MOCK RESULT" : "MOCK HERMES",
    body: "Ready visual result for: " + cleanText(task, 110),
    bullets: [
      "Runtime launched from text command.",
      "Status updates were paced.",
      "Semantic JSON produced the final HUD.",
    ],
    footer: "DYNAMIC RESULT",
    created_at: new Date().toISOString(),
  };
}

function genericHermesOutputWidget(task: string, stdout: string, stderr: string, code: number | null): PeripheralWidget {
  const output = cleanText(stdout || stderr || "Hermes completed without visible output.", 240);
  return {
    id: code === 0 ? "hermes-real-result" : "hermes-real-error",
    type: "generic_card",
    title: code === 0 ? "Hermes Result" : "Hermes Error",
    status: code === 0 ? "completed" : "error",
    body: output,
    bullets: ["Task: " + cleanText(task, 80)],
    footer: "WRAPPER GENERATED",
    created_at: new Date().toISOString(),
  };
}

function parseHermesWidget(stdout: string): PeripheralWidget | null {
  const text = stdout.trim();
  const candidates = [text, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)].filter((item) => item.trim().startsWith("{"));
  for (const candidate of candidates) {
    try {
      return assertWidget(JSON.parse(candidate) as unknown);
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function hermesPrompt(task: string): string {
  return [
    "You are producing a visual HUD result for monochrome waveguide glasses.",
    "Complete the user task, then return ONLY one JSON object.",
    "If file writing tools are available, also write that same JSON object to the path in PERIPHERAL_HUD_WIDGET_PATH.",
    "Do not include Markdown, raw transport packets, or pixel data.",
    "Use this schema subset:",
    "{\"id\":\"hermes-result\",\"type\":\"generic_card\",\"title\":\"...\",\"status\":\"completed\",\"body\":\"...\",\"bullets\":[\"...\"],\"footer\":\"...\"}",
    "For tabular results you may use type table with columns and rows.",
    "For action lists you may use type checklist with items [{\"label\":\"...\",\"checked\":true}].",
    "User task: " + task,
  ].join("\n");
}

function compactCliChunk(chunk: string): string {
  return cleanText(chunk.replace(/\x1b\[[0-9;]*m/g, " "), 120);
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, " ")
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, " ");
}

export function sanitizeTerminalLine(value: string): string {
  const clean = stripAnsi(value)
    .replace(/⚕/g, "Hermes")
    .replace(/❯/g, ">")
    .replace(/✦/g, "*")
    .replace(/✓/g, "OK")
    .replace(/✗/g, "X")
    .replace(/⏲/g, "time")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[·•]/g, "-")
    .replace(/[\u2500-\u257f]/g, " ")
    .replace(/[\u2580-\u259f]/g, " ")
    .replace(/[\u2800-\u28ff]/g, " ")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\[\s+\]/g, "[]")
    .trim();
  return /^[\s|+\-_=.,:;[\]()]+$/.test(clean) ? "" : clean;
}

export function compactHermesTerminalLines(values: string[]): string[] {
  const lines: string[] = [];
  let skippedStartupNoise = false;

  for (const value of values) {
    const clean = sanitizeTerminalLine(value);
    if (!clean) continue;
    if (isHermesStartupNoise(clean)) {
      skippedStartupNoise = true;
      continue;
    }

    const normalized = normalizeHermesTerminalLine(clean);
    if (!normalized) continue;
    if (isAdjacentDuplicateTerminalLine(lines, normalized)) continue;
    lines.push(normalized);
  }

  return skippedStartupNoise ? compactHermesStartupOnlyLines(lines) : lines;
}

function cleanTerminalLine(value: string): string {
  return sanitizeTerminalLine(value);
}

function normalizeHermesTerminalLine(value: string): string {
  if (value === ">") return ">";
  return value.replace(/^>\s+/, "> ");
}

function isAdjacentDuplicateTerminalLine(lines: string[], value: string): boolean {
  const previous = lines[lines.length - 1];
  if (previous !== value) return false;
  return value === ">" || value.startsWith("Hermes ") || value.startsWith("ASR draft:");
}

function compactHermesStartupOnlyLines(lines: string[]): string[] {
  const version = lines.find(isHermesVersionLine);
  if (!version) return lines;
  const extra = lines.filter((line) =>
    line !== version &&
    line !== ">" &&
    !isHermesStatusLine(line)
  );
  return extra.length === 0 ? [version] : lines;
}

function isHermesVersionLine(value: string): boolean {
  return /^Hermes Agent v\S+/.test(value);
}

function isHermesStatusLine(value: string): boolean {
  return /^Hermes gpt-[A-Za-z0-9_.-]+\b/.test(value);
}

function isHermesStartupNoise(value: string): boolean {
  if (/^Available (Tools|Skills)$/.test(value)) return true;
  if (value === "MCP Servers") return true;
  if (/^\(and \d+ more (toolsets?|skills?)\.\.\.\)$/.test(value)) return true;
  if (/^\d+ tools - \d+ skills - \d+ MCP servers - \/help for commands$/.test(value)) return true;
  if (/^Welcome to Hermes Agent! Type your message or \/help for commands\.?$/.test(value)) return true;
  if (/^(\* )?Tip: /.test(value)) return true;
  if (value === "Hermes Hermes") return true;
  if (/^\/(reasoning|fast)\b/.test(value)) return true;
  if (/^OK Reasoning effort set to /.test(value)) return true;
  if (/^OK Priority Processing set to /.test(value)) return true;
  if (/^MCP server config changed /.test(value)) return true;
  if (/^Reloading MCP servers/.test(value)) return true;
  if (/^Reconnected: /.test(value)) return true;
  if (/^\d+ tool\(s\) available from \d+ server\(s\)/.test(value)) return true;
  if (/^Agent updated - \d+ tool\(s\) available/.test(value)) return true;
  if (/^Session: \d{8}_\d{6}(?:_[A-Za-z0-9]+)?(?: Available Skills)?$/.test(value)) return true;
  if (/^gpt-[A-Za-z0-9_.-]+ - .*\((?:http|stdio)\) - failed$/.test(value)) return true;
  if (/^\/Users\/karimyahia\/.*\b(peripheral|hermes)\b/.test(value)) return true;
  if (isHermesToolCatalogLine(value)) return true;
  if (isHermesMcpCatalogLine(value)) return true;
  if (isHermesSkillCatalogLine(value)) return true;
  return false;
}

function isHermesToolCatalogLine(value: string): boolean {
  const prefix = value.split(":")[0] || "";
  return [
    "browser",
    "browser-cdp",
    "clarify",
    "code_execution",
    "cronjob",
    "delegation",
    "discord",
    "discord_admin",
    "filesystem",
    "github",
    "gmail",
    "notion",
    "slack",
    "terminal",
    "web_search",
  ].includes(prefix);
}

function isHermesMcpCatalogLine(value: string): boolean {
  return /^(moss|crustdata|agentmail|browser-use|agentphone|sponge)(\s|\()/.test(value) && (value.includes("tool(s)") || /\bfailed\b/.test(value));
}

function isHermesSkillCatalogLine(value: string): boolean {
  const prefix = value.split(":")[0] || "";
  return [
    "apple",
    "autonomous-ai-agents",
    "business",
    "creative",
    "crypto",
    "data",
    "data-science",
    "devops",
    "dogfood",
    "documents",
    "email",
    "engineering",
    "finance",
    "gaming",
    "general",
    "github",
    "hardware",
    "image",
    "inference-sh",
    "leisure",
    "mcp",
    "media",
    "mlops",
    "note-taking",
    "productivity",
    "red-teaming",
    "research",
    "sandbox",
    "smart-home",
    "social-media",
    "software-development",
    "software-engineering",
    "web",
    "writing",
  ].includes(prefix);
}

export function normalizeTmuxSessionName(value: string): string | null {
  const clean = value.trim();
  if (!clean) return null;
  const safe = clean.replace(/[^A-Za-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  if (!safe) return null;
  return /^[A-Za-z0-9]/.test(safe) ? safe : "peripheral_" + safe;
}

function resolveExecutablePath(name: string): string | null {
  const result = spawnSync("sh", ["-lc", "command -v " + shellQuote(name)], {
    encoding: "utf8",
    timeout: 2_000,
  });
  if (result.status !== 0) return null;
  const value = String(result.stdout || "").trim().split(/\r?\n/)[0] || "";
  return value || null;
}

function normalizeVoiceControlCommand(value: string): string {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/[.,!?;:"'\x60]+/g, " ")
    .replace(/\bplease\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isVoiceSendCommand(command: string): boolean {
  return ["send", "send it", "submit", "submit it"].includes(command);
}

function splitTrailingVoiceSend(value: string): { shouldSend: boolean; text: string } {
  const clean = cleanText(value, 240);
  const match = /^(.*?)[,;:]\s*(?:please\s+)?(?:send|submit)(?:\s+(?:please|it))?[.!?]*$/i.exec(clean);
  if (!match) return { shouldSend: false, text: clean };
  const text = cleanText(match[1] || "", 240);
  return { shouldSend: Boolean(text), text };
}

function splitHermesPromptWake(command: string): { wake: boolean; prompt: string } {
  const clean = normalizeVoiceControlCommand(command);
  if (clean === "hermes") return { wake: true, prompt: "" };
  const match = /^(?:hey\s+)?hermes(?:\s+agent)?\s+(.+)$/.exec(clean);
  if (!match) return { wake: false, prompt: clean };
  return { wake: true, prompt: cleanText(match[1] || "", 240) };
}

export function mergeVoiceDraft(current: string, piece: string, previousPiece = ""): string {
  const draft = cleanText(current, 900);
  const next = cleanText(piece, 240);
  const previous = cleanText(previousPiece, 240);
  if (!next) return draft;
  if (!draft) return next;
  if (previous && next.toLowerCase().startsWith(previous.toLowerCase())) {
    const prefix = draft.slice(0, Math.max(0, draft.length - previous.length)).trim();
    return cleanText([prefix, next].filter(Boolean).join(" "), 900);
  }
  return cleanText([draft, next].join(" "), 900);
}

function normalizeAgentName(name: string): string {
  const clean = cleanText(name, 40);
  return clean ? clean[0]!.toUpperCase() + clean.slice(1) : "Agent";
}

function agentSortKey(name: string): number {
  const order = ["Hermes", "Codex", "Claude", "OpenCode"];
  const index = order.findIndex((item) => item.toLowerCase() === name.toLowerCase());
  return index === -1 ? 99 : index;
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value);
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 48) || "hud";
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
