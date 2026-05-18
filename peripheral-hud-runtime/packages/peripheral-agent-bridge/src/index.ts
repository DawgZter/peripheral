import {
  assertWidget,
  cleanText,
  type AgentEvent,
  type AgentEventKind,
  type AgentStatus,
  type ApprovalRiskLevel,
  type Choice,
  type PeripheralWidget,
  type SurfaceCommand,
  type SurfaceKind,
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
  now?: Date;
};

export type AgentBridgeTranscript = {
  schema: "peripheral-agent-bridge-transcript-v1";
  generatedAt: string;
  events: AgentEvent[];
  widgets: PeripheralWidget[];
};

export type AgentBridgeSurfaceRoute = {
  schema: "peripheral-agent-bridge-surface-route-v1";
  event: AgentEvent;
  widget: PeripheralWidget;
  command: SurfaceCommand;
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

export function normalizeAgentCliLine(input: AgentBridgeLine): AgentEvent {
  const now = input.now || new Date();
  const adapter = agentCliIntegrations.find((item) => item.id === input.agentId);
  if (!adapter) throw new Error("Unknown agent CLI adapter: " + input.agentId);
  const line = cleanText(input.line, 220);
  const classified = classifyLine(line);
  const id = [
    input.agentId,
    input.sessionId,
    String(input.sequence ?? 1).padStart(3, "0"),
    classified.kind,
  ].join("-");
  return {
    kind: classified.kind,
    id,
    source: sourceFor(input.agentId, input.sessionId),
    session_id: input.sessionId,
    title: classified.title || adapter.name,
    summary: classified.summary || line,
    status: classified.status,
    risk: classified.risk,
    progress: classified.progress,
    capabilities: ["hud_render", "approval_gate", "live_status"],
    choices: classified.choices,
    widget: widgetForAgentEvent({
      kind: classified.kind,
      id,
      source: sourceFor(input.agentId, input.sessionId),
      session_id: input.sessionId,
      title: classified.title || adapter.name,
      summary: classified.summary || line,
      status: classified.status,
      risk: classified.risk,
      progress: classified.progress,
      choices: classified.choices,
      created_at: now.toISOString(),
    }),
    created_at: now.toISOString(),
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
  const priority = decisionRequired || event.kind === "session_error" || event.kind === "session_waiting" ? "high" : "normal";
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

export function buildAgentBridgeDossier(now = new Date()): Record<string, unknown> {
  const transcript = buildAgentBridgeTranscript(now);
  return {
    schema: "peripheral-agent-bridge-dossier-v1",
    generatedAt: now.toISOString(),
    adapters: buildAgentBridgeAdapters(),
    launchSpecs: buildAgentLaunchSpecs(),
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
    ],
  };
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
      risk: /push|deploy|payment|delete|rm -rf/.test(lower) ? "high" : "medium",
      title: "Approval Required",
      summary: line,
      choices: approvalChoices(),
    };
  }
  if (/failed|error|exception|blocked by error|cannot/.test(lower)) {
    return { kind: "session_error", status: "error", risk: "medium", title: "Agent Error", summary: line };
  }
  if (/complete|completed|done|success|merged|finished/.test(lower)) {
    return { kind: "session_completed", status: "completed", progress: 1, title: "Agent Complete", summary: line };
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
  if (event.kind === "session_error" || event.kind === "session_waiting" || event.status === "waiting") return "pinned";
  return "glance";
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
