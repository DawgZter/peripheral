import { spawnSync } from "node:child_process";
import {
  assertWidget,
  cleanText,
  type AgentEvent,
  type AgentEventKind,
  type AgentStatus,
  type ApprovalRiskLevel,
  type Choice,
  type ConfirmationLevel,
  type JsonValue,
  type PeripheralWidget,
  type SurfaceCommand,
  type SurfaceKind,
  type UserDecision,
} from "../../peripheral-protocol/src/index.js";
import { AGENT_CLI_IDS, agentCliIntegrations, sourceFor, type AgentCliId } from "../../peripheral-integrations/src/index.js";

export type AgentBridgeSurface = "progress_card" | "approval_card" | "terminal_fallback" | "completion_card" | "error_card";

export type AgentBridgeAdapter = {
  id: AgentCliId;
  name: string;
  command: string;
  sessionModel: string;
  env: string[];
  wakeNames: string[];
  defaultSurface: AgentBridgeSurface;
  terminalFallback: true;
  approvalPolicy: {
    low: string;
    medium: string;
    high: string;
  };
};

export type AgentBridgeLine = {
  agentId: AgentCliId;
  sessionId: string;
  line: string;
  sequence?: number;
  transcriptUri?: string;
  now?: Date;
};

export type AgentBridgeTranscript = {
  schema: "peripheral-agent-bridge-transcript-v1";
  generatedAt: string;
  events: AgentEvent[];
  widgets: PeripheralWidget[];
};

export type AgentBridgeSessionPack = {
  schema: "peripheral-agent-bridge-session-pack-v1";
  generatedAt: string;
  sessionPrefix: string;
  phoneGateway: AgentBridgePhoneGatewayPlan;
  agents: AgentBridgeSessionPackAgent[];
  approvals: Array<{
    agentId: AgentCliId;
    eventId: string;
    surface: SurfaceKind;
    commandId: string;
  }>;
};

export type AgentBridgeSessionPackAgent = {
  id: AgentCliId;
  name: string;
  command: string;
  sessionId: string;
  transcriptLine: string;
  event: AgentEvent;
  widget: PeripheralWidget;
  commandSurface: SurfaceCommand;
  runtime: {
    start: string[];
    route: string[];
    approvalTransport: AgentRuntimeAdapterPlan["approvals"]["transport"];
    surfaces: SurfaceKind[];
    focusedApprovalWinsInput: true;
  };
};

export type AgentBridgeSurfaceRoute = {
  schema: "peripheral-agent-bridge-surface-route-v1";
  event: AgentEvent;
  widget: PeripheralWidget;
  command: SurfaceCommand;
};

export type AgentBridgePhoneGatewayPlan = {
  route: "agent_stdout_to_surface_command";
  surfaceOwner: "phone_runtime";
  displayPolicy: "lease_arbiter_required";
  transport: "semantic_surface_commands";
};

export type AgentLaunchSpec = {
  id: AgentCliId;
  name: string;
  status: "live_ready";
  command: string;
  args: string[];
  envNames: string[];
  sessionModel: string;
  cwdPolicy: "repo_root";
  stdout: "line_stream_to_agent_event";
  stdin: "approval_router_to_process";
  surfacePolicy: "phone_owned_surface_policy";
};

export type AgentBridgeLaunchCommand = {
  schema: "peripheral-agent-cli-launch-v1";
  generatedAt: string;
  id: AgentCliId;
  name: string;
  sessionId: string;
  sessionName: string;
  command: string;
  args: string[];
  cwd: string;
  envNames: string[];
  sessionModel: AgentLaunchSpec["sessionModel"];
  transcriptUri?: string;
  stdout: "line_stream_to_agent_event";
  stderr: "line_stream_to_agent_event";
  routeCommand: string[];
  prompt?: string;
};

export type AgentBridgeLaunchCommandInput = {
  agentId: AgentCliId;
  sessionId: string;
  cwd: string;
  prompt?: string;
  commandOverride?: string;
  argsOverride?: string[];
  transcriptUri?: string;
  now?: Date;
};

export type AgentRuntimePlan = {
  schema: "peripheral-agent-runtime-plan-v1";
  generatedAt: string;
  phoneGateway: AgentBridgePhoneGatewayPlan;
  agents: AgentRuntimeAdapterPlan[];
  guarantees: string[];
};

export type AgentBridgeApprovalChoice = "approve" | "deny" | "details";

export type AgentBridgeApprovalReturn = {
  eventId: string;
  sessionId: string;
  choice: AgentBridgeApprovalChoice;
  transport: AgentRuntimeAdapterPlan["approvals"]["transport"];
  targetSession: string;
  stdinLine: string;
  tmuxCommand?: string[];
  adapterPayload: Record<string, JsonValue>;
};

export type AgentBridgeRuntimeHandshake = {
  schema: "peripheral-agent-bridge-runtime-handshake-v1";
  generatedAt: string;
  transcript: {
    source: "stdout" | "stderr";
    sequence: number;
    line: string;
    transcriptUri?: string;
  };
  plan: AgentRuntimePlan;
  route: AgentBridgeSurfaceRoute;
  phoneGateway: {
    surfaceOwner: "phone_runtime";
    displayPolicy: "lease_arbiter_required";
    focusedInput: "focused_card_then_named_agent_then_mode_then_broker";
    commandKind: SurfaceCommand["kind"];
    surface: SurfaceKind;
  };
  approval?: {
    decision: UserDecision;
    returnPath: AgentBridgeApprovalReturn;
  };
};

export type AgentRuntimeAdapterPlan = {
  id: AgentCliId;
  name: string;
  command: string;
  argv: string[];
  session: {
    id: string;
    model: AgentLaunchSpec["sessionModel"];
    cwdPolicy: AgentLaunchSpec["cwdPolicy"];
    terminal: AgentLaunchSpec["sessionModel"];
  };
  credentials: {
    envNames: string[];
    binding: "external_runtime_env";
  };
  io: {
    stdout: "line_stream_to_agent_event";
    stderr: "line_stream_to_agent_event";
    stdin: "approval_router_to_process";
    transcript: "jsonl_audit";
  };
  glasses: {
    route: "AgentEvent_to_PeripheralWidget_to_SurfaceCommand";
    surfaces: SurfaceKind[];
    focusedApprovalWinsInput: true;
  };
  approvals: {
    transport: "stdin_line" | "tmux_send_keys" | "pty_stdin_line" | "adapter_callback";
    approve: string;
    deny: string;
    details: string;
  };
  operatorCommands: {
    start: string[];
    route: string[];
    approve: string[];
    deny: string[];
  };
};

export type AgentCliLaunchInput = {
  agentId: AgentCliId;
  sessionId: string;
  task: string;
  cwd?: string;
  now?: Date;
};

export type AgentCliLaunchOptions = {
  execute?: boolean;
  commandOverride?: string;
  argsOverride?: string[];
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxLines?: number;
  transcriptUri?: string;
};

export type AgentCliLaunchResult = {
  schema: "peripheral-agent-cli-launch-v1";
  ok: boolean;
  mode: "phone_gateway" | "process";
  generatedAt: string;
  agent: {
    id: AgentCliId;
    name: string;
    sessionId: string;
  };
  process: {
    command: string;
    args: string[];
    cwd: string;
    executablePath: string | null;
    timeoutMs: number;
    status?: number | null;
    signal?: NodeJS.Signals | null;
    stdoutLines: string[];
    stderrLines: string[];
    error?: string;
  };
  runtimePlan: AgentRuntimeAdapterPlan;
  routes: AgentBridgeSurfaceRoute[];
  events: AgentEvent[];
  widgets: PeripheralWidget[];
  commands: SurfaceCommand[];
};

export function isAgentCliId(value: string): value is AgentCliId {
  return (AGENT_CLI_IDS as readonly string[]).includes(value);
}

export function normalizeAgentCliId(value: string): AgentCliId {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const aliases: Record<string, AgentCliId> = {
    claw: "openclaw",
    open_claw: "openclaw",
    claude: "claude_code",
    claude_code_cli: "claude_code",
    pi_cli: "pi",
    open_code: "opencode",
    oc: "opencode",
    gemini: "gemini_cli",
    codex: "codex_cli",
  };
  const normalized = aliases[key] || key;
  if (isAgentCliId(normalized)) return normalized;
  throw new Error("Unknown agent CLI " + value + ". Use one of: " + AGENT_CLI_IDS.join(", ") + ".");
}

export function buildAgentBridgeAdapters(): AgentBridgeAdapter[] {
  return agentCliIntegrations.map((agent) => ({
    id: agent.id,
    name: agent.name,
    command: agent.command,
    sessionModel: agent.sessionModel,
    env: agent.env,
    wakeNames: [agent.name, agent.command, ...agent.aliases].filter(Boolean),
    defaultSurface: "progress_card",
    terminalFallback: true,
    approvalPolicy: agent.approvalPolicy,
  }));
}

export function buildAgentLaunchSpecs(): AgentLaunchSpec[] {
  return agentCliIntegrations.map((agent) => ({
    id: agent.id,
    name: agent.name,
    status: "live_ready",
    command: agent.command,
    args: launchArgsForAgent(agent.id),
    envNames: agent.env,
    sessionModel: agent.sessionModel,
    cwdPolicy: "repo_root",
    stdout: "line_stream_to_agent_event",
    stdin: "approval_router_to_process",
    surfacePolicy: "phone_owned_surface_policy",
  }));
}

export function buildAgentBridgeLaunchCommand(input: AgentBridgeLaunchCommandInput): AgentBridgeLaunchCommand {
  const now = input.now || new Date();
  const agent = agentCliIntegrations.find((item) => item.id === input.agentId);
  if (!agent) throw new Error("Unknown agent CLI adapter: " + input.agentId);
  const baseArgs = input.argsOverride ? [...input.argsOverride] : launchArgsForAgent(agent.id);
  const prompt = cleanText(input.prompt || "", 1200);
  const args = prompt ? [...baseArgs, prompt] : baseArgs;
  return {
    schema: "peripheral-agent-cli-launch-v1",
    generatedAt: now.toISOString(),
    id: agent.id,
    name: agent.name,
    sessionId: input.sessionId,
    sessionName: sessionNameForAgent(agent.id, input.sessionId),
    command: input.commandOverride || agent.command,
    args,
    cwd: input.cwd,
    envNames: agent.env,
    sessionModel: agent.sessionModel,
    transcriptUri: input.transcriptUri,
    stdout: "line_stream_to_agent_event",
    stderr: "line_stream_to_agent_event",
    routeCommand: ["peripheralctl", "agent-bridge", "route", "--agent", agent.id, "--session-id", input.sessionId, "--line", "<stdout line>"],
    prompt: prompt || undefined,
  };
}

export function buildAgentRuntimePlan(now = new Date(), agentId?: AgentCliId, sessionId = "agent-session"): AgentRuntimePlan {
  const agents = agentCliIntegrations
    .filter((agent) => !agentId || agent.id === agentId)
    .map((agent) => runtimePlanForAgent(agent, sessionId));
  return {
    schema: "peripheral-agent-runtime-plan-v1",
    generatedAt: now.toISOString(),
    phoneGateway: {
      route: "agent_stdout_to_surface_command",
      surfaceOwner: "phone_runtime",
      displayPolicy: "lease_arbiter_required",
      transport: "semantic_surface_commands",
    },
    agents,
    guarantees: [
      "Agent CLIs never write raw display transport.",
      "Every stdout line can be normalized into an AgentEvent.",
      "Focused approval cards win approve, deny, details, and dismiss input.",
      "Terminal fallback is bounded; semantic widgets remain the default glasses surface.",
    ],
  };
}

export function buildAgentBridgeRuntimeHandshake(input: AgentBridgeLine & { choice?: AgentBridgeApprovalChoice; stream?: "stdout" | "stderr" }): AgentBridgeRuntimeHandshake {
  const now = input.now || new Date();
  const agentId = normalizeAgentCliId(input.agentId);
  const line = cleanText(input.line, 220);
  const sequence = input.sequence ?? 1;
  const plan = buildAgentRuntimePlan(now, agentId, input.sessionId);
  const adapterPlan = plan.agents[0];
  if (!adapterPlan) throw new Error("No runtime adapter plan for " + agentId);
  const route = routeAgentBridgeLine({
    agentId,
    sessionId: input.sessionId,
    sequence,
    line,
    transcriptUri: input.transcriptUri,
    now,
  });
  const decision = route.event.kind === "approval_required"
    ? buildAgentBridgeApprovalDecision(route.event, input.choice || "approve", now)
    : undefined;
  return {
    schema: "peripheral-agent-bridge-runtime-handshake-v1",
    generatedAt: now.toISOString(),
    transcript: {
      source: input.stream || "stdout",
      sequence,
      line,
      transcriptUri: input.transcriptUri,
    },
    plan,
    route,
    phoneGateway: {
      surfaceOwner: "phone_runtime",
      displayPolicy: "lease_arbiter_required",
      focusedInput: "focused_card_then_named_agent_then_mode_then_broker",
      commandKind: route.command.kind,
      surface: route.command.surface,
    },
    approval: decision
      ? {
          decision,
          returnPath: buildAgentBridgeApprovalReturn(adapterPlan, route.event, decision),
        }
      : undefined,
  };
}

export function buildAgentBridgeApprovalDecision(event: AgentEvent, choice: AgentBridgeApprovalChoice = "approve", now = new Date()): UserDecision {
  return {
    kind: "approval_decision",
    event_id: event.id,
    session_id: event.session_id,
    decision: choice,
    choice_id: choice,
    confirmation_level: confirmationLevelForRisk(event.risk),
    reason: "Wearer decision captured by the phone runtime focused card.",
    source: {
      id: "phone-runtime",
      label: "Phone Runtime",
      kind: "system",
      vendor: "Peripheral",
      trust: "local",
      session_id: event.session_id,
    },
    metadata: {
      focused_card_id: event.widget?.id || "",
      source_agent: event.source.id,
      return_route: "approval_router_to_process",
    },
    timestamp: now.toISOString(),
  };
}

export function buildAgentBridgeApprovalReturn(plan: AgentRuntimeAdapterPlan, event: AgentEvent, decision: UserDecision): AgentBridgeApprovalReturn {
  const choice = decision.decision === "deny" ? "deny" : decision.decision === "details" ? "details" : "approve";
  const stdinLine = choice + "\n";
  const payload: Record<string, JsonValue> = {
    event_id: event.id,
    session_id: event.session_id,
    decision: choice,
    confirmation_level: decision.confirmation_level,
    agent_id: plan.id,
  };
  return {
    eventId: event.id,
    sessionId: event.session_id,
    choice,
    transport: plan.approvals.transport,
    targetSession: plan.session.id,
    stdinLine,
    tmuxCommand: plan.approvals.transport === "tmux_send_keys"
      ? ["tmux", "send-keys", "-t", plan.session.id, choice, "Enter"]
      : undefined,
    adapterPayload: payload,
  };
}

export function runAgentCliLaunch(input: AgentCliLaunchInput, options: AgentCliLaunchOptions = {}): AgentCliLaunchResult {
  const now = input.now || new Date();
  const agent = agentCliIntegrations.find((item) => item.id === input.agentId);
  if (!agent) throw new Error("Unknown agent CLI adapter: " + input.agentId);
  const command = options.commandOverride || agent.command;
  const args = options.argsOverride || processArgsForAgent(agent.id, input.task);
  const cwd = input.cwd || process.cwd();
  const timeoutMs = options.timeoutMs || 15_000;
  const executablePath = resolveExecutablePath(command);
  const base = {
    schema: "peripheral-agent-cli-launch-v1" as const,
    generatedAt: now.toISOString(),
    agent: {
      id: agent.id,
      name: agent.name,
      sessionId: input.sessionId,
    },
    process: {
      command,
      args,
      cwd,
      executablePath,
      timeoutMs,
      stdoutLines: [] as string[],
      stderrLines: [] as string[],
    },
    runtimePlan: runtimePlanForAgent(agent, input.sessionId),
  };

  if (!options.execute) {
    const line = agent.name + " session started for " + cleanText(input.task || "agent task", 120) + ".";
    return finishAgentCliLaunch(base, "phone_gateway", true, [line], now, options.transcriptUri);
  }

  if (!executablePath) {
    const line = agent.name + " cannot start because command " + command + " was not found.";
    return finishAgentCliLaunch({
      ...base,
      process: {
        ...base.process,
        error: "command_not_found",
      },
    }, "process", false, [line], now, options.transcriptUri);
  }

  const spawned = spawnSync(command, args, {
    cwd,
    env: mergeProcessEnv(options.env),
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  const stdoutLines = splitProcessLines(spawned.stdout);
  const stderrLines = splitProcessLines(spawned.stderr);
  const lines = [...stdoutLines, ...stderrLines].slice(0, options.maxLines || 30);
  const ok = !spawned.error && spawned.status === 0;
  const fallbackLine = ok
    ? agent.name + " completed process with status 0."
    : agent.name + " reported an error while running the agent command.";
  return finishAgentCliLaunch({
    ...base,
    process: {
      ...base.process,
      status: spawned.status,
      signal: spawned.signal,
      stdoutLines,
      stderrLines,
      error: spawned.error ? spawned.error.message : undefined,
    },
  }, "process", ok, lines.length > 0 ? lines : [fallbackLine], now, options.transcriptUri);
}

export function normalizeAgentCliLine(input: AgentBridgeLine): AgentEvent {
  const now = input.now || new Date();
  const adapter = agentCliIntegrations.find((item) => item.id === input.agentId);
  if (!adapter) throw new Error("Unknown agent CLI adapter: " + input.agentId);
  const sequence = input.sequence ?? 1;
  const line = cleanText(input.line, 220);
  const classified = classifyLine(line);
  const id = [
    input.agentId,
    input.sessionId,
    String(sequence).padStart(3, "0"),
    classified.kind,
  ].join("-");
  const source = sourceFor(input.agentId, input.sessionId);
  const surface = surfaceForClassifiedLine(classified);
  const decisionRequired = classified.kind === "approval_required";
  const confirmationLevel = confirmationLevelForRisk(classified.risk);
  const event: AgentEvent = {
    kind: classified.kind,
    id,
    source,
    session_id: input.sessionId,
    title: classified.title || adapter.name,
    summary: classified.summary || line,
    status: classified.status,
    risk: classified.risk,
    progress: classified.progress,
    capabilities: capabilitiesForClassifiedLine(classified),
    references: [
      {
        label: adapter.name + " transcript line " + String(sequence).padStart(3, "0"),
        uri: input.transcriptUri,
        kind: input.transcriptUri ? "log" : "note",
      },
    ],
    choices: classified.choices,
    metadata: agentEventMetadata({
      adapterId: input.agentId,
      command: adapter.command,
      sessionModel: adapter.sessionModel,
      sequence,
      line,
      surface,
      decisionRequired,
      confirmationLevel,
    }),
    created_at: now.toISOString(),
  };
  return {
    ...event,
    widget: widgetForAgentEvent({
      ...event,
      widget: undefined,
    }),
  };
}

export function widgetForAgentEvent(event: AgentEvent, now = new Date()): PeripheralWidget {
  const label = event.source.label;
  if (event.kind === "approval_required") {
    return assertWidget({
      id: event.id + "-widget",
      type: "approval_card",
      title: event.title,
      status: (event.risk || "medium").toUpperCase() + " RISK",
      body: event.summary || "Agent is requesting permission.",
      choices: event.choices || approvalChoices(),
      source: label,
      created_at: now.toISOString(),
    });
  }
  if (event.kind === "session_completed") {
    return assertWidget({
      id: event.id + "-widget",
      type: "checklist",
      title: label + " Done",
      status: "COMPLETED",
      items: [
        { label: cleanText(event.summary || "Task completed", 80), checked: true, status: "done" },
        { label: "Audit event recorded", checked: true, status: event.session_id },
      ],
      footer: "Agent bridge normalized event",
      source: label,
      created_at: now.toISOString(),
    });
  }
  if (event.kind === "session_error") {
    return assertWidget({
      id: event.id + "-widget",
      type: "generic_card",
      title: label + " Error",
      status: "ERROR",
      body: event.summary || "Agent reported an error.",
      icon: "warning",
      footer: "Open terminal fallback",
      source: label,
      created_at: now.toISOString(),
    });
  }
  if (event.kind === "session_stuck") {
    return assertWidget({
      id: event.id + "-widget",
      type: "generic_card",
      title: label + " Needs Attention",
      status: "NEEDS ATTENTION",
      body: event.summary || "Agent appears stuck and needs a decision or fallback.",
      icon: "warning",
      bullets: ["Pinned until dismissed", "Open terminal fallback for context"],
      footer: event.session_id,
      source: label,
      created_at: now.toISOString(),
    });
  }
  if (event.kind === "session_waiting" || event.status === "waiting") {
    return assertWidget({
      id: event.id + "-widget",
      type: "generic_card",
      title: label + " Waiting",
      status: "WAITING",
      body: event.summary || "Agent is waiting for input.",
      bullets: ["Focused card wins input", "Say approve, deny, details, or dismiss"],
      footer: event.session_id,
      source: label,
      created_at: now.toISOString(),
    });
  }
  return assertWidget({
    id: event.id + "-widget",
    type: "terminal",
    title: label + " Progress",
    status: event.status || "running",
    terminal: [
      "$ " + (event.source.command || event.source.label.toLowerCase()),
      cleanText(event.summary || event.title, 150),
      "surface: semantic first",
      "fallback: bounded terminal",
    ],
    prompt: "Agent bridge",
    source: label,
    created_at: now.toISOString(),
  });
}

export function surfaceCommandForAgentEvent(event: AgentEvent, now = new Date()): SurfaceCommand {
  const widget = event.widget || widgetForAgentEvent(event, now);
  const decisionRequired = event.kind === "approval_required";
  const surface = surfaceForAgentEvent(event);
  const mode = decisionRequired || surface === "pinned" ? "agent_mode" : "ambient_agent_hud";
  const priority = decisionRequired || event.kind === "session_error" || event.kind === "session_stuck" || event.kind === "session_waiting" ? "high" : "normal";
  const command: SurfaceCommand = {
    kind: decisionRequired ? "show_card" : "show_widget",
    id: "command-agent-" + sanitizeId(event.id),
    mode,
    surface,
    lease: {
      id: "lease-agent-" + sanitizeId(event.session_id || event.id),
      owner: "broker",
      priority,
      surface,
      mode,
      interruptible: true,
      reason: decisionRequired
        ? event.source.label + " requested focused wearer approval."
        : event.source.label + " published a wearer-visible status update.",
      source: event.source,
      requested_capabilities: decisionRequired ? ["approval_gate", "hud_render"] : ["live_status", "hud_render"],
      agent_session_id: event.session_id,
      ttl_ms: decisionRequired ? undefined : 8000,
      created_at: now.toISOString(),
    },
    source: event.source,
    decision_required: decisionRequired,
    reason: decisionRequired
      ? "Agent bridge routed approval to the phone-owned focused card."
      : "Agent bridge routed status to the phone-owned HUD surface.",
    created_at: now.toISOString(),
  };
  if (decisionRequired) {
    command.card = widget;
  } else {
    command.widget = widget;
  }
  return command;
}

export function routeAgentBridgeLine(input: AgentBridgeLine): AgentBridgeSurfaceRoute {
  const now = input.now || new Date();
  const event = normalizeAgentCliLine({ ...input, now });
  const widget = event.widget || widgetForAgentEvent(event, now);
  return {
    schema: "peripheral-agent-bridge-surface-route-v1",
    event,
    widget,
    command: surfaceCommandForAgentEvent({ ...event, widget }, now),
  };
}

export function buildAgentBridgeTranscript(now = new Date()): AgentBridgeTranscript {
  const samples: AgentBridgeLine[] = [
    { agentId: "codex_cli", sessionId: "codex-auth-fix", sequence: 1, line: "Codex needs approval to run npm test before committing.", now },
    { agentId: "claude_code", sessionId: "claude-refactor", sequence: 2, line: "Claude Code is editing the renderer and is 40% complete.", now },
    { agentId: "gemini_cli", sessionId: "gemini-brief", sequence: 3, line: "Gemini completed a multimodal summary for the broker.", now },
    { agentId: "opencode", sessionId: "opencode-plan", sequence: 4, line: "OpenCode is waiting on user input for apply patch.", now },
    { agentId: "openclaw", sessionId: "claw-workspace", sequence: 5, line: "OpenClaw failed to locate the requested workspace.", now },
    { agentId: "pi", sessionId: "pi-companion", sequence: 6, line: "Pi is running a conversational companion prompt.", now },
  ];
  const events = samples.map(normalizeAgentCliLine);
  return {
    schema: "peripheral-agent-bridge-transcript-v1",
    generatedAt: now.toISOString(),
    events,
    widgets: events.map((event) => event.widget || widgetForAgentEvent(event, now)),
  };
}

export function buildAgentBridgeSessionPack(now = new Date(), sessionPrefix = "review"): AgentBridgeSessionPack {
  const runtime = buildAgentRuntimePlan(now, undefined, sessionPrefix);
  const agents: AgentBridgeSessionPackAgent[] = agentCliIntegrations.map((agent, index) => {
    const sessionId = sessionPrefix + "-" + agent.id.replace(/_/g, "-");
    const transcriptLine = sessionPackLine(agent.id);
    const route = routeAgentBridgeLine({
      agentId: agent.id,
      sessionId,
      sequence: index + 1,
      line: transcriptLine,
      now,
    });
    const runtimePlan = runtime.agents.find((item) => item.id === agent.id) || runtimePlanForAgent(agent, sessionPrefix);
    return {
      id: agent.id,
      name: agent.name,
      command: agent.command,
      sessionId,
      transcriptLine,
      event: route.event,
      widget: route.widget,
      commandSurface: route.command,
      runtime: {
        start: runtimePlan.operatorCommands.start,
        route: runtimePlan.operatorCommands.route,
        approvalTransport: runtimePlan.approvals.transport,
        surfaces: runtimePlan.glasses.surfaces,
        focusedApprovalWinsInput: runtimePlan.glasses.focusedApprovalWinsInput,
      },
    };
  });
  return {
    schema: "peripheral-agent-bridge-session-pack-v1",
    generatedAt: now.toISOString(),
    sessionPrefix,
    phoneGateway: runtime.phoneGateway,
    agents,
    approvals: agents
      .filter((agent) => agent.commandSurface.decision_required)
      .map((agent) => ({
        agentId: agent.id,
        eventId: agent.event.id,
        surface: agent.commandSurface.surface,
        commandId: agent.commandSurface.id,
      })),
  };
}

export function buildAgentBridgeDossier(now = new Date()): Record<string, unknown> {
  const transcript = buildAgentBridgeTranscript(now);
  return {
    schema: "peripheral-agent-bridge-dossier-v1",
    generatedAt: now.toISOString(),
    adapters: buildAgentBridgeAdapters(),
    launchSpecs: buildAgentLaunchSpecs(),
    runtimePlan: buildAgentRuntimePlan(now),
    sessionPack: buildAgentBridgeSessionPack(now),
    transcript,
    routing: [
      "Focused approval card receives approve/deny/details first.",
      "Explicit agent names route to the matching CLI adapter.",
      "Mode commands such as look up or dismiss route to the phone mode manager.",
      "Unmatched text falls back to the default broker brain.",
    ],
    safety: [
      "Adapters observe CLI text and emit AgentEvent objects.",
      "No adapter can push raw BLE, raw pixels, or hardware writes.",
      "Terminal fallback is bounded and semantic widgets are preferred.",
      "Launch commands run as local CLI processes and still route through phone-owned surface policy.",
    ],
  };
}

function sessionPackLine(agentId: AgentCliId): string {
  switch (agentId) {
    case "openclaw":
      return "OpenClaw started the workspace task and is streaming progress.";
    case "claude_code":
      return "Claude Code requests permission to edit the renderer files.";
    case "pi":
      return "Pi is stuck waiting for a short wearer response.";
    case "opencode":
      return "OpenCode is waiting on user input before apply.";
    case "gemini_cli":
      return "Gemini completed the broker summary for the current session.";
    case "codex_cli":
      return "Codex is 40% through the checks and still running.";
  }
}

function runtimePlanForAgent(agent: (typeof agentCliIntegrations)[number], sessionId: string): AgentRuntimeAdapterPlan {
  const argv = launchArgsForAgent(agent.id);
  const start = [agent.command, ...argv];
  const route = ["peripheralctl", "agent-bridge", "route", "--agent", agent.id, "--session-id", sessionId, "--line", "<stdout line>"];
  return {
    id: agent.id,
    name: agent.name,
    command: agent.command,
    argv,
    session: {
      id: sessionNameForAgent(agent.id, sessionId),
      model: agent.sessionModel,
      cwdPolicy: "repo_root",
      terminal: agent.sessionModel,
    },
    credentials: {
      envNames: agent.env,
      binding: "external_runtime_env",
    },
    io: {
      stdout: "line_stream_to_agent_event",
      stderr: "line_stream_to_agent_event",
      stdin: "approval_router_to_process",
      transcript: "jsonl_audit",
    },
    glasses: {
      route: "AgentEvent_to_PeripheralWidget_to_SurfaceCommand",
      surfaces: ["glance", "fullscreen", "pinned"],
      focusedApprovalWinsInput: true,
    },
    approvals: approvalReturnPath(agent.sessionModel),
    operatorCommands: {
      start,
      route,
      approve: approvalCommand(agent.id, sessionId, "approve"),
      deny: approvalCommand(agent.id, sessionId, "deny"),
    },
  };
}

function processArgsForAgent(id: AgentCliId, task: string): string[] {
  const args = launchArgsForAgent(id);
  const cleanTask = cleanText(task, 500);
  return cleanTask ? [...args, cleanTask] : args;
}

function launchArgsForAgent(id: AgentCliId): string[] {
  switch (id) {
    case "codex_cli":
      return ["--model", "gpt-5.5", "--reasoning-effort", "xhigh"];
    case "claude_code":
      return [];
    case "gemini_cli":
      return ["--model", "gemini-2.5-pro"];
    case "opencode":
      return ["run"];
    case "openclaw":
      return ["run"];
    case "pi":
      return ["chat"];
  }
}

function finishAgentCliLaunch(
  base: Omit<AgentCliLaunchResult, "ok" | "mode" | "routes" | "events" | "widgets" | "commands">,
  mode: AgentCliLaunchResult["mode"],
  ok: boolean,
  lines: string[],
  now: Date,
  transcriptUri?: string,
): AgentCliLaunchResult {
  const routes = lines.map((line, index) => routeAgentBridgeLine({
    agentId: base.agent.id,
    sessionId: base.agent.sessionId,
    line,
    sequence: index + 1,
    transcriptUri: transcriptUri || "peripheral://agent-bridge/" + base.agent.sessionId + "/transcript",
    now,
  }));
  return {
    ...base,
    ok,
    mode,
    routes,
    events: routes.map((route) => route.event),
    widgets: routes.map((route) => route.widget),
    commands: routes.map((route) => route.command),
  };
}

function resolveExecutablePath(command: string): string | null {
  const result = spawnSync("sh", ["-lc", "command -v " + shellQuote(command)], {
    encoding: "utf8",
    timeout: 2_000,
  });
  if (result.status !== 0) return null;
  return cleanText(String(result.stdout || "").trim().split(/\r?\n/)[0] || "", 500) || null;
}

function mergeProcessEnv(env: Record<string, string | undefined> | undefined): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(env || {})) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function splitProcessLines(value: string | Buffer | undefined): string[] {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => cleanText(line, 220))
    .filter(Boolean);
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function approvalReturnPath(sessionModel: AgentLaunchSpec["sessionModel"]): AgentRuntimeAdapterPlan["approvals"] {
  const transport =
    sessionModel === "tmux"
      ? "tmux_send_keys"
      : sessionModel === "pty"
        ? "pty_stdin_line"
        : sessionModel === "adapter"
          ? "adapter_callback"
          : "stdin_line";
  return {
    transport,
    approve: "approve",
    deny: "deny",
    details: "details",
  };
}

function approvalCommand(agentId: AgentCliId, sessionId: string, choice: "approve" | "deny"): string[] {
  return ["peripheralctl", "phone-runtime", "decide", "--event", [agentId, sessionId, "001", "approval_required"].join("-"), "--choice", choice];
}

function sessionNameForAgent(agentId: AgentCliId, sessionId: string): string {
  return "peripheral-" + sanitizeId(agentId + "-" + sessionId);
}

type ClassifiedLine = {
  kind: AgentEventKind;
  status: AgentStatus;
  risk?: ApprovalRiskLevel;
  progress?: number;
  title?: string;
  summary?: string;
  choices?: Choice[];
};

function classifyLine(line: string): ClassifiedLine {
  const lower = line.toLowerCase();
  if (/approval|permission|allow|confirm|proceed|run npm|apply patch|push|deploy/.test(lower)) {
    return {
      kind: "approval_required",
      status: "waiting",
      risk: /push|deploy|payment|charge|delete|rm -rf|send email|submit form/.test(lower) ? "high" : "medium",
      title: "Approval Required",
      summary: line,
      choices: approvalChoices(),
    };
  }
  if (/session (started|created)|started|starting|launching|spawned/.test(lower)) {
    return { kind: "session_started", status: "launching", title: "Agent Started", summary: line };
  }
  if (/failed|error|exception|blocked by error|cannot/.test(lower)) {
    return { kind: "session_error", status: "error", risk: "medium", title: "Agent Error", summary: line };
  }
  if (/complete|completed|done|success|merged|finished/.test(lower)) {
    return { kind: "session_completed", status: "completed", progress: 1, title: "Agent Complete", summary: line };
  }
  if (/stuck|hung|timed out|timeout|no progress/.test(lower)) {
    return { kind: "session_stuck", status: "needs_attention", risk: "medium", title: "Agent Needs Attention", summary: line };
  }
  if (/waiting|blocked|needs user|needs input|stuck/.test(lower)) {
    return { kind: "session_waiting", status: "waiting", risk: "medium", title: "Agent Waiting", summary: line };
  }
  const progress = lower.match(/(\d{1,3})\s*%/);
  return {
    kind: "session_progress",
    status: "running",
    progress: progress ? Math.min(1, Number(progress[1]) / 100) : undefined,
    title: "Agent Progress",
    summary: line,
  };
}

function surfaceForAgentEvent(event: AgentEvent): SurfaceKind {
  if (event.kind === "approval_required") return "fullscreen";
  if (event.kind === "session_error" || event.kind === "session_stuck" || event.kind === "session_waiting" || event.status === "waiting") return "pinned";
  return "glance";
}

function surfaceForClassifiedLine(classified: ClassifiedLine): SurfaceKind {
  if (classified.kind === "approval_required") return "fullscreen";
  if (classified.kind === "session_error" || classified.kind === "session_stuck" || classified.kind === "session_waiting" || classified.status === "waiting") return "pinned";
  return "glance";
}

function capabilitiesForClassifiedLine(classified: ClassifiedLine): AgentEvent["capabilities"] {
  const capabilities: NonNullable<AgentEvent["capabilities"]> = ["hud_render", "live_status"];
  if (classified.kind === "approval_required") capabilities.push("approval_gate");
  return capabilities;
}

function confirmationLevelForRisk(risk: ApprovalRiskLevel | undefined): ConfirmationLevel {
  if (risk === "high") return "phone";
  if (risk === "medium") return "voice_and_tap";
  return "voice";
}

function agentEventMetadata(input: {
  adapterId: AgentCliId;
  command: string;
  sessionModel: string;
  sequence: number;
  line: string;
  surface: SurfaceKind;
  decisionRequired: boolean;
  confirmationLevel: ConfirmationLevel;
}): Record<string, JsonValue> {
  return {
    adapter_id: input.adapterId,
    command: input.command,
    session_model: input.sessionModel,
    sequence: input.sequence,
    terminal_line: input.line,
    surface: input.surface,
    decision_required: input.decisionRequired,
    confirmation_level: input.confirmationLevel,
  };
}

function approvalChoices(): Choice[] {
  return [
    { id: "approve", label: "Approve", tone: "primary" },
    { id: "deny", label: "Deny", tone: "danger" },
    { id: "details", label: "Details", tone: "secondary" },
  ];
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "agent";
}
