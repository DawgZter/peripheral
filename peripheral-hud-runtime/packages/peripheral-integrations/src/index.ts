import {
  type AgentEvent,
  type AppMode,
  type Choice,
  type PeripheralSource,
  type PeripheralWidget,
  type SurfaceCommand,
  type SurfaceKind,
  type SurfaceLease,
} from "../../peripheral-protocol/src/index.js";

export type IntegrationStatus = "ready" | "stubbed" | "needs_key" | "needs_install" | "planned";

export type Capability = {
  id: string;
  label: string;
  description: string;
  surface: SurfaceKind;
  risk: "low" | "medium" | "high";
};

export type SponsorIntegration = {
  id: SponsorId;
  name: string;
  role: string;
  docs: string;
  env: string[];
  surfaces: Capability[];
  agentEvents: string[];
  status: IntegrationStatus;
  notes: string[];
};

export type AgentCliIntegration = {
  id: AgentCliId;
  name: string;
  command: string;
  aliases: string[];
  detection: {
    commands: string[];
    env: string[];
    strategy: "path";
  };
  installHint: string;
  sessionModel: "stdio" | "pty" | "tmux" | "http" | "adapter";
  env: string[];
  surfaces: Capability[];
  approvalPolicy: {
    low: string;
    medium: string;
    high: string;
  };
  status: IntegrationStatus;
  notes: string[];
};

export type IntegrationSummary = {
  sponsors: SponsorIntegration[];
  agentClis: AgentCliIntegration[];
  counts: {
    sponsorCount: number;
    agentCliCount: number;
    sponsorCapabilities: number;
    agentCliCapabilities: number;
  };
};

export type EnvSnapshot = Record<string, string | undefined>;

export type IntegrationReadiness = {
  kind: "sponsor" | "agent_cli";
  id: SponsorId | AgentCliId;
  name: string;
  status: IntegrationStatus;
  docs?: string;
  command?: string;
  env: string[];
  presentEnv: string[];
  missingEnv: string[];
  readyForLive: boolean;
  mockReady: true;
  nextAction: string;
};

export type IntegrationReadinessReport = {
  schema: "peripheral-integration-readiness-v1";
  generatedAt: string;
  totals: {
    integrations: number;
    mockReady: number;
    liveReady: number;
    missingEnv: number;
  };
  integrations: IntegrationReadiness[];
  note: string;
};

export type PeripheralMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  output: string;
  risk: "low" | "medium" | "high";
};

export type PeripheralMcpManifest = {
  schema: "peripheral-mcp-manifest-v1";
  generatedAt: string;
  server: {
    name: "peripheral-glass-broker";
    transport: "stdio";
    surfaceRuntime: "phone-owned-renderer";
  };
  resources: Array<{
    uri: string;
    description: string;
  }>;
  tools: PeripheralMcpTool[];
};

export type BrokerTimeline = {
  schema: "peripheral-broker-timeline-v1";
  generatedAt: string;
  premise: string;
  steps: Array<{
    id: string;
    actor: string;
    event: string;
    route: string;
    surface: SurfaceKind;
    risk: "low" | "medium" | "high";
    widget: PeripheralWidget;
    command: SurfaceCommand;
  }>;
};

export type MockConnectionState = {
  schema: "peripheral-connected-state-v1";
  mode: AppMode;
  generatedAt: string;
  glasses: {
    connected: true;
    transport: "mock_phone_gateway";
    display: "540x280_2bpp";
    batteryPercent: number;
    rssi: number;
    firmware: string;
  };
  phone: {
    connected: true;
    appMode: AppMode;
    ownsBle: true;
    renderer: "semantic_widget_to_monochrome_bitmap";
    inputRouter: "voice_tap_head_pose";
  };
  broker: {
    connected: true;
    mcp: "local_glass_broker";
    policy: "surface_lease_arbiter";
    activeLease: SurfaceLease;
  };
  surfaceCommands: SurfaceCommand[];
  widgets: PeripheralWidget[];
};

export const SPONSOR_IDS = [
  "agentphone",
  "stripe",
  "supermemory",
  "agentmail",
  "browser_use",
  "sponge",
  "gemini",
] as const;

export type SponsorId = (typeof SPONSOR_IDS)[number];

export const AGENT_CLI_IDS = [
  "openclaw",
  "claude_code",
  "pi",
  "opencode",
  "gemini_cli",
  "codex_cli",
] as const;

export type AgentCliId = (typeof AGENT_CLI_IDS)[number];

const approvalChoices: Choice[] = [
  { id: "approve", label: "Approve", tone: "primary" },
  { id: "deny", label: "Deny", tone: "danger" },
  { id: "details", label: "Details", tone: "secondary" },
];

export const sponsorIntegrations: SponsorIntegration[] = [
  {
    id: "agentphone",
    name: "AgentPhone",
    role: "Coordinator and call-control plane for human-visible agent actions.",
    docs: "https://docs.agentphone.com/",
    env: ["AGENTPHONE_API_KEY", "AGENTPHONE_PHONE_NUMBER"],
    status: "stubbed",
    agentEvents: ["call_started", "call_connected", "call_summary", "human_takeover_requested"],
    surfaces: [
      capability("agentphone.call_status", "Live call HUD", "Shows calling, connected, and handoff state from an active phone agent.", "glance", "low"),
      capability("agentphone.handoff", "Human takeover card", "Escalates a call when the agent needs spoken or tapped confirmation.", "fullscreen", "medium"),
      capability("agentphone.transcript", "Transcript chips", "Streams last-turn transcript snippets into the glasses renderer.", "glance", "low"),
    ],
    notes: [
      "AgentPhone owns call identity and phone-number coordination; Peripheral only renders semantic state.",
      "The adapter intentionally emits cards instead of raw audio or BLE writes.",
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    role: "Payments, setup intents, card holds, receipts, and monetization checkpoints.",
    docs: "https://docs.stripe.com/",
    env: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"],
    status: "stubbed",
    agentEvents: ["payment_intent_requires_action", "setup_intent_created", "receipt_available", "risk_review"],
    surfaces: [
      capability("stripe.card_hold", "Card-hold approval", "Shows refundable holds and requires explicit user confirmation.", "fullscreen", "medium"),
      capability("stripe.receipt", "Receipt glance", "Shows amount, merchant, status, and receipt action after an agent purchase.", "glance", "low"),
      capability("stripe.high_risk", "High-risk payment block", "Escalates high-risk payment actions to phone or desktop confirmation.", "pinned", "high"),
    ],
    notes: [
      "Low-risk receipts can be glance-only; payment methods and production charges require higher confirmation.",
      "No keys are required for the checked-in mock surfaces.",
    ],
  },
  {
    id: "supermemory",
    name: "Supermemory",
    role: "Persistent memory and retrieval layer for agent context on the glasses.",
    docs: "https://docs.supermemory.ai/",
    env: ["SUPERMEMORY_API_KEY", "SUPERMEMORY_CONTAINER"],
    status: "stubbed",
    agentEvents: ["memory_saved", "memory_search_result", "profile_updated"],
    surfaces: [
      capability("supermemory.recall", "Memory recall card", "Condenses retrieved context into a few wearer-safe bullets.", "glance", "low"),
      capability("supermemory.save", "Memory save approval", "Asks before storing sensitive remembered facts.", "fullscreen", "medium"),
      capability("supermemory.profile", "Profile context", "Shows why an agent is using a remembered preference.", "tiny_hud", "low"),
    ],
    notes: [
      "Adapters should tag memories with the active agent session and wearer intent.",
      "Sensitive auto-capture paths are represented as approval cards, not silent writes.",
    ],
  },
  {
    id: "agentmail",
    name: "AgentMail",
    role: "Agent-readable email inboxes, outbound drafts, and verification loops.",
    docs: "https://docs.agentmail.to/",
    env: ["AGENTMAIL_API_KEY", "AGENTMAIL_INBOX"],
    status: "stubbed",
    agentEvents: ["mail_received", "draft_ready", "verification_code_found", "reply_sent"],
    surfaces: [
      capability("agentmail.inbox", "Inbox triage", "Shows a tiny count or top urgent thread for the active agent.", "tiny_hud", "low"),
      capability("agentmail.draft", "Draft approval", "Displays a concise outbound email draft approval surface.", "fullscreen", "medium"),
      capability("agentmail.otp", "Verification code", "Pins short-lived codes when an agent flow needs them.", "pinned", "medium"),
    ],
    notes: [
      "Drafts are approval-gated so glasses never silently send email.",
      "Inbox surfaces should redact sender details unless the user enters Agent Mode.",
    ],
  },
  {
    id: "browser_use",
    name: "Browser Use",
    role: "Browser automation evidence and step-level website navigation telemetry.",
    docs: "https://docs.browser-use.com/",
    env: ["BROWSER_USE_API_KEY"],
    status: "stubbed",
    agentEvents: ["browser_step", "browser_waiting", "browser_result", "browser_error"],
    surfaces: [
      capability("browser_use.step", "Browser step HUD", "Shows the page title and current browser action in a glance card.", "glance", "low"),
      capability("browser_use.approval", "Sensitive browser action", "Asks before submitting forms, payments, or account mutations.", "fullscreen", "high"),
      capability("browser_use.evidence", "Screenshot evidence", "Summarizes screenshot-derived proof as text for the monochrome HUD.", "glance", "low"),
    ],
    notes: [
      "The HUD receives semantic progress, never a raw browser screenshot stream by default.",
      "Form submission and authenticated mutations are treated as high-risk events.",
    ],
  },
  {
    id: "sponge",
    name: "Sponge",
    role: "Context compression and ambient signal sponge for agent working memory.",
    docs: "https://sponge.ai/docs",
    env: ["SPONGE_API_KEY", "SPONGE_PROJECT_ID"],
    status: "stubbed",
    agentEvents: ["context_absorbed", "context_clustered", "summary_ready"],
    surfaces: [
      capability("sponge.digest", "Context digest", "Turns noisy agent/browser/call state into a short HUD digest.", "glance", "low"),
      capability("sponge.cluster", "Signal clusters", "Shows top grouped signals when multiple agents are active.", "glance", "low"),
      capability("sponge.redaction", "Redaction warning", "Flags potentially sensitive context before persistence.", "pinned", "medium"),
    ],
    notes: [
      "Sponge is modeled as the compression stage before long-lived memory or display.",
      "The checked-in adapter is a deterministic contract until live credentials are provided.",
    ],
  },
  {
    id: "gemini",
    name: "Gemini",
    role: "Multimodal broker reasoning, summarization, and structured HUD generation.",
    docs: "https://ai.google.dev/gemini-api/docs",
    env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    status: "stubbed",
    agentEvents: ["broker_summary", "visual_reasoning_result", "route_decision"],
    surfaces: [
      capability("gemini.broker", "Broker brain", "Ranks interruptions and selects a semantic HUD surface.", "glance", "low"),
      capability("gemini.vision", "Vision summary", "Converts visual context into wearer-safe bullets.", "fullscreen", "medium"),
      capability("gemini.routing", "Agent routing", "Routes voice intent to the focused card, named agent, or default broker.", "tiny_hud", "low"),
    ],
    notes: [
      "Gemini is represented as optional broker intelligence behind deterministic policy checks.",
      "The policy kernel still owns leases, focus, and approval routing.",
    ],
  },
];

export const agentCliIntegrations: AgentCliIntegration[] = [
  agentCli("openclaw", "OpenClaw", "openclaw", ["claw"], "Install OpenClaw and expose an openclaw executable on PATH.", "pty", ["OPENCLAW_API_KEY"], "planned", [
    "Treats claw tasks as workspace sessions with terminal fallback and approval events.",
  ]),
  agentCli("claude_code", "Claude Code CLI", "claude", ["claude-code"], "Install Claude Code and authenticate with its local CLI flow.", "tmux", ["ANTHROPIC_API_KEY"], "stubbed", [
    "PTY/tmux capture lets the phone app show normal terminal progress without owning the session.",
  ]),
  agentCli("pi", "Pi", "pi", ["inflection", "pi-cli"], "Install the Pi CLI or provide a compatible adapter command named pi.", "adapter", ["PI_API_KEY"], "planned", [
    "Modeled as a conversational companion agent with voice-first reply surfaces.",
  ]),
  agentCli("opencode", "OpenCode", "opencode", ["oc"], "Install OpenCode and run through a workspace-scoped PTY.", "pty", ["OPENCODE_API_KEY"], "stubbed", [
    "Maps OpenCode plan/apply/waiting states into generic AgentEvent objects.",
  ]),
  agentCli("gemini_cli", "Gemini CLI", "gemini", ["gemini-cli"], "Install Gemini CLI and authenticate with Google AI Studio or gcloud.", "stdio", ["GEMINI_API_KEY", "GOOGLE_API_KEY"], "stubbed", [
    "Used for broker summaries, multimodal notes, and low-risk routing suggestions.",
  ]),
  agentCli("codex_cli", "Codex CLI", "codex", [], "Install Codex CLI and run sessions from the Mac broker workspace.", "tmux", ["OPENAI_API_KEY"], "stubbed", [
    "Codex events become approval cards, progress cards, and raw terminal fallback panes.",
  ]),
];

export function buildIntegrationSummary(): IntegrationSummary {
  return {
    sponsors: sponsorIntegrations,
    agentClis: agentCliIntegrations,
    counts: {
      sponsorCount: sponsorIntegrations.length,
      agentCliCount: agentCliIntegrations.length,
      sponsorCapabilities: sponsorIntegrations.reduce((count, item) => count + item.surfaces.length, 0),
      agentCliCapabilities: agentCliIntegrations.reduce((count, item) => count + item.surfaces.length, 0),
    },
  };
}

export function buildReadinessReport(env: EnvSnapshot = {}, now = new Date()): IntegrationReadinessReport {
  const integrations: IntegrationReadiness[] = [
    ...sponsorIntegrations.map((item) => readinessForSponsor(item, env)),
    ...agentCliIntegrations.map((item) => readinessForAgentCli(item, env)),
  ];
  return {
    schema: "peripheral-integration-readiness-v1",
    generatedAt: now.toISOString(),
    totals: {
      integrations: integrations.length,
      mockReady: integrations.filter((item) => item.mockReady).length,
      liveReady: integrations.filter((item) => item.readyForLive).length,
      missingEnv: integrations.reduce((count, item) => count + item.missingEnv.length, 0),
    },
    integrations,
    note: "Readiness intentionally reports env var names only; it never includes secret values.",
  };
}

export function buildPeripheralMcpManifest(now = new Date()): PeripheralMcpManifest {
  return {
    schema: "peripheral-mcp-manifest-v1",
    generatedAt: now.toISOString(),
    server: {
      name: "peripheral-glass-broker",
      transport: "stdio",
      surfaceRuntime: "phone-owned-renderer",
    },
    resources: [
      {
        uri: "peripheral://surface/connected-state",
        description: "Mock-safe connected glasses, phone runtime, broker lease, and current widgets.",
      },
      {
        uri: "peripheral://integrations/sponsors",
        description: "Sponsor adapter capabilities and event names for AgentPhone, Stripe, Supermemory, AgentMail, Browser Use, Sponge, and Gemini.",
      },
      {
        uri: "peripheral://integrations/agent-clis",
        description: "Agent CLI adapter manifest for OpenClaw, Claude Code CLI, Pi, OpenCode, Gemini CLI, and Codex CLI.",
      },
    ],
    tools: [
      mcpTool("peripheral.enter_agent_mode", "Ask the phone runtime to enter Agent Mode and grant the broker a fullscreen lease.", "low"),
      mcpTool("peripheral.show_widget", "Render a semantic widget on the glasses through the phone-owned renderer.", "low"),
      mcpTool("peripheral.request_approval", "Show a focused approval card with event_id, session_id, risk, and choices.", "medium"),
      mcpTool("peripheral.route_input", "Route voice/tap/head-pose input to the focused card, named agent, app mode, or default broker.", "medium"),
      mcpTool("peripheral.block_raw_ble", "Reject direct BLE/pixel writes from agents and explain the semantic surface contract.", "high"),
    ],
  };
}

export function buildBrokerTimeline(now = new Date()): BrokerTimeline {
  const connected = buildMockConnectedState(now);
  const lease = connected.broker.activeLease;
  const steps = [
    timelineStep("step-agentphone-call", "AgentPhone", "call_connected", "AgentPhone -> broker -> phone renderer", "glance", "low", liveCallWidget(now), lease, now),
    timelineStep("step-browser-use-proof", "Browser Use", "browser_step", "Browser Use -> broker evidence digest -> glasses glance", "glance", "low", browserProofWidget(now), lease, now),
    timelineStep("step-stripe-approval", "Stripe", "payment_intent_requires_action", "Stripe event -> approval policy -> focused approval card", "fullscreen", "medium", buildApprovalEvent("stripe", "booking-hold", "Approve Card Hold?", "AgentPhone booking needs a refundable Stripe hold.", now).widget!, lease, now),
    timelineStep("step-codex-terminal", "Codex CLI", "session_waiting", "Codex CLI PTY -> bounded terminal fallback -> pinned surface", "pinned", "medium", terminalWidget(now), lease, now),
    timelineStep("step-gemini-route", "Gemini", "route_decision", "Gemini suggestion -> deterministic router -> focused card reply", "tiny_hud", "low", routingWidget(now), lease, now),
  ];
  return {
    schema: "peripheral-broker-timeline-v1",
    generatedAt: now.toISOString(),
    premise: "Agents and sponsors never write raw BLE; every event is normalized into a broker timeline and rendered by the phone runtime.",
    steps,
  };
}

export function buildSponsorMatrixWidget(now = new Date()): PeripheralWidget {
  return {
    id: "sponsor-matrix",
    type: "table",
    title: "Sponsor Stack",
    status: "7 ADAPTERS",
    columns: ["Sponsor", "Surface", "State"],
    rows: sponsorIntegrations.map((item) => ({
      Sponsor: item.name,
      Surface: item.surfaces[0]?.label || "HUD",
      State: item.status,
    })),
    footer: "Agent Mode sponsor coverage",
    source: "peripheral-integrations",
    created_at: now.toISOString(),
  };
}

export function buildAgentCliMatrixWidget(now = new Date()): PeripheralWidget {
  return {
    id: "agent-cli-matrix",
    type: "table",
    title: "Agent CLIs",
    status: "6 ADAPTERS",
    columns: ["CLI", "Cmd", "Surface"],
    rows: agentCliIntegrations.map((item) => ({
      CLI: item.name,
      Cmd: item.command,
      Surface: item.sessionModel,
    })),
    footer: "Codex, Claude, Gemini, OpenCode, OpenClaw, Pi",
    source: "peripheral-integrations",
    created_at: now.toISOString(),
  };
}

export function buildAgentCockpitWidget(now = new Date()): PeripheralWidget {
  return {
    id: "agent-cockpit-connected",
    type: "checklist",
    title: "Agent Mode",
    status: "GLASSES CONNECTED",
    items: [
      { label: "Phone owns BLE and renderer", checked: true, status: "current_stage" },
      { label: "Mac broker accepts MCP-style events", checked: true, status: "agent_mode" },
      { label: "Surface lease arbiter active", checked: true, status: "ready" },
      { label: "Sponsor adapters mapped", checked: true, status: "7" },
      { label: "Agent CLI adapters mapped", checked: true, status: "6" },
      { label: "Live display writes gated", checked: true, status: "safe" },
    ],
    footer: "Mock phone gateway / no BLE writes",
    source: "peripheral-integrations",
    created_at: now.toISOString(),
  };
}

export function buildApprovalEvent(sourceId: SponsorId | AgentCliId, sessionId: string, title: string, summary: string, now = new Date()): AgentEvent {
  const source = sourceFor(sourceId, sessionId);
  return {
    kind: "approval_required",
    id: "approval-" + slug(sourceId + "-" + sessionId),
    source,
    session_id: sessionId,
    title,
    summary,
    risk: "medium",
    status: "waiting",
    choices: approvalChoices,
    widget: {
      id: "approval-" + slug(sourceId + "-" + sessionId),
      type: "approval_card",
      title,
      status: "APPROVAL",
      body: summary,
      choices: approvalChoices,
      source: source.label,
      created_at: now.toISOString(),
    },
    created_at: now.toISOString(),
  };
}

export function buildMockConnectedState(now = new Date()): MockConnectionState {
  const activeLease: SurfaceLease = {
    id: "lease-agent-mode-main",
    owner: "broker",
    priority: "high",
    surface: "fullscreen",
    mode: "agent_mode",
    interruptible: true,
    reason: "User entered Agent Mode from the phone app.",
    source: {
      id: "glass-broker",
      label: "Glass Broker",
      kind: "system",
      vendor: "Peripheral",
    },
    created_at: now.toISOString(),
  };
  const widgets = [
    buildAgentCockpitWidget(now),
    buildSponsorMatrixWidget(now),
    buildAgentCliMatrixWidget(now),
    buildApprovalEvent("stripe", "reservation-card-hold", "Approve Card Hold?", "Stripe card hold for AgentPhone restaurant booking.").widget!,
  ];
  return {
    schema: "peripheral-connected-state-v1",
    mode: "agent_mode",
    generatedAt: now.toISOString(),
    glasses: {
      connected: true,
      transport: "mock_phone_gateway",
      display: "540x280_2bpp",
      batteryPercent: 87,
      rssi: -48,
      firmware: "peripheral-public-demo",
    },
    phone: {
      connected: true,
      appMode: "agent_mode",
      ownsBle: true,
      renderer: "semantic_widget_to_monochrome_bitmap",
      inputRouter: "voice_tap_head_pose",
    },
    broker: {
      connected: true,
      mcp: "local_glass_broker",
      policy: "surface_lease_arbiter",
      activeLease,
    },
    surfaceCommands: widgets.map((widget, index) => ({
      kind: index === 0 ? "enter_agent_mode" : "show_widget",
      id: "surface-command-" + String(index + 1).padStart(2, "0"),
      mode: "agent_mode",
      surface: index === 0 ? "fullscreen" : "glance",
      lease: activeLease,
      widget,
      source: activeLease.source,
      reason: "Mock connected-glasses hackathon walkthrough.",
      created_at: now.toISOString(),
    })),
    widgets,
  };
}

export function buildHackathonDossier(now = new Date()): Record<string, unknown> {
  const summary = buildIntegrationSummary();
  const connected = buildMockConnectedState(now);
  const readiness = buildReadinessReport({}, now);
  return {
    schema: "peripheral-hackathon-dossier-v1",
    generatedAt: now.toISOString(),
    thesis: "Peripheral makes smart glasses an agent-first surface: the phone owns BLE/rendering, the Mac broker owns agent sessions, and agents request semantic UI through a policy-gated bridge.",
    sponsorCoverage: summary.sponsors.map((item) => ({
      sponsor: item.name,
      role: item.role,
      docs: item.docs,
      status: item.status,
      env: item.env,
      capabilities: item.surfaces.map((surface) => surface.label),
    })),
    agentCliCoverage: summary.agentClis.map((item) => ({
      agent: item.name,
      command: item.command,
      aliases: item.aliases,
      sessionModel: item.sessionModel,
      status: item.status,
      capabilities: item.surfaces.map((surface) => surface.label),
    })),
    connectedGlasses: connected,
    readiness,
    mcpManifest: buildPeripheralMcpManifest(now),
    brokerTimeline: buildBrokerTimeline(now),
    safety: [
      "Agents emit semantic widgets, never raw BLE bytes.",
      "Phone app owns display leases and final rendering.",
      "Medium and high risk actions are approval-gated.",
      "Checked-in demo state uses mock_phone_gateway and performs no live display writes.",
    ],
  };
}

export function sourceFor(id: SponsorId | AgentCliId, sessionId?: string): PeripheralSource {
  const sponsor = sponsorIntegrations.find((item) => item.id === id);
  if (sponsor) {
    return { id: sponsor.id, label: sponsor.name, kind: "sponsor", vendor: sponsor.name, session_id: sessionId };
  }
  const agent = agentCliIntegrations.find((item) => item.id === id);
  if (agent) {
    return { id: agent.id, label: agent.name, kind: "agent_cli", vendor: agent.name, session_id: sessionId };
  }
  return { id, label: id, kind: "demo", session_id: sessionId };
}

function capability(id: string, label: string, description: string, surface: SurfaceKind, risk: Capability["risk"]): Capability {
  return { id, label, description, surface, risk };
}

function agentCli(
  id: AgentCliId,
  name: string,
  command: string,
  aliases: string[],
  installHint: string,
  sessionModel: AgentCliIntegration["sessionModel"],
  env: string[],
  status: IntegrationStatus,
  notes: string[],
): AgentCliIntegration {
  return {
    id,
    name,
    command,
    aliases,
    detection: {
      commands: [command, ...aliases],
      env,
      strategy: "path",
    },
    installHint,
    sessionModel,
    env,
    status,
    notes,
    approvalPolicy: {
      low: "voice approval may be enough for local, reversible actions",
      medium: "voice plus tap or phone confirmation",
      high: "phone or desktop confirmation only",
    },
    surfaces: [
      capability(id + ".progress", "Progress card", "Summarizes current task, plan, and next action.", "glance", "low"),
      capability(id + ".approval", "Approval card", "Captures permission requests with event_id and session_id.", "fullscreen", "medium"),
      capability(id + ".terminal", "Raw terminal fallback", "Shows bounded terminal lines when semantic state is unavailable.", "pinned", "medium"),
    ],
  };
}

function readinessForSponsor(item: SponsorIntegration, env: EnvSnapshot): IntegrationReadiness {
  const presentEnv = item.env.filter((key) => Boolean(env[key]));
  const missingEnv = item.env.filter((key) => !env[key]);
  return {
    kind: "sponsor",
    id: item.id,
    name: item.name,
    status: item.status,
    docs: item.docs,
    env: item.env,
    presentEnv,
    missingEnv,
    readyForLive: missingEnv.length === 0 && item.status === "ready",
    mockReady: true,
    nextAction: missingEnv.length
      ? "Add " + missingEnv.join(", ") + " to enable live API wiring."
      : "Promote the adapter from " + item.status + " after live API smoke validation.",
  };
}

function readinessForAgentCli(item: AgentCliIntegration, env: EnvSnapshot): IntegrationReadiness {
  const presentEnv = item.env.filter((key) => Boolean(env[key]));
  const missingEnv = item.env.filter((key) => !env[key]);
  return {
    kind: "agent_cli",
    id: item.id,
    name: item.name,
    status: item.status,
    command: item.command,
    env: item.env,
    presentEnv,
    missingEnv,
    readyForLive: missingEnv.length === 0 && item.status === "ready",
    mockReady: true,
    nextAction: missingEnv.length
      ? "Install/authenticate " + item.name + " and provide " + missingEnv.join(", ") + " if required."
      : "Connect " + item.command + " to the broker PTY/session adapter.",
  };
}

function mcpTool(name: string, description: string, risk: PeripheralMcpTool["risk"]): PeripheralMcpTool {
  return {
    name,
    description,
    risk,
    output: "SurfaceCommand or UserDecision routed through the phone-owned renderer.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      required: ["session_id"],
      properties: {
        session_id: { type: "string" },
        source: { type: "string" },
        widget: { type: "object" },
        risk: { enum: ["low", "medium", "high"] },
      },
    },
  };
}

function timelineStep(
  id: string,
  actor: string,
  event: string,
  route: string,
  surface: SurfaceKind,
  risk: Capability["risk"],
  widget: PeripheralWidget,
  lease: SurfaceLease,
  now: Date,
): BrokerTimeline["steps"][number] {
  return {
    id,
    actor,
    event,
    route,
    surface,
    risk,
    widget,
    command: {
      kind: surface === "fullscreen" ? "show_card" : "show_widget",
      id: "command-" + id,
      mode: "agent_mode",
      surface,
      lease,
      widget,
      source: sourceFor(actorToSourceId(actor), id),
      decision_required: risk !== "low",
      reason: route,
      created_at: now.toISOString(),
    },
  };
}

function actorToSourceId(actor: string): SponsorId | AgentCliId {
  switch (actor) {
    case "AgentPhone":
      return "agentphone";
    case "Browser Use":
      return "browser_use";
    case "Stripe":
      return "stripe";
    case "Codex CLI":
      return "codex_cli";
    case "Gemini":
      return "gemini";
    default:
      return "agentphone";
  }
}

function liveCallWidget(now: Date): PeripheralWidget {
  return {
    id: "timeline-agentphone-call",
    type: "live_call",
    title: "AgentPhone",
    status: "CONNECTED",
    transcript: [
      { speaker: "agent", text: "Confirming the booking and checking deposit policy." },
      { speaker: "other", text: "We can hold it with a refundable card authorization." },
    ],
    facts: ["Call agent active", "Human can take over", "Deposit question"],
    source: "agentphone",
    created_at: now.toISOString(),
  };
}

function browserProofWidget(now: Date): PeripheralWidget {
  return {
    id: "timeline-browser-use",
    type: "generic_card",
    title: "Browser Use",
    status: "EVIDENCE",
    body: "Reservation page loaded; form is ready but submit is approval-gated.",
    icon: "browser",
    footer: "No raw screenshots on HUD",
    source: "browser_use",
    created_at: now.toISOString(),
  };
}

function terminalWidget(now: Date): PeripheralWidget {
  return {
    id: "timeline-codex-terminal",
    type: "terminal",
    title: "Codex CLI",
    status: "WAITING",
    terminal: [
      "> npm run check",
      "needs approval: run local checks",
      "approve / deny / details",
    ],
    prompt: "Reply to focused approval",
    source: "codex_cli",
    created_at: now.toISOString(),
  };
}

function routingWidget(now: Date): PeripheralWidget {
  return {
    id: "timeline-gemini-routing",
    type: "status_icon",
    title: "Gemini Route",
    status: "FOCUSED CARD",
    body: "Voice input routes to the visible approval before default broker fallback.",
    icon: "route",
    source: "gemini",
    created_at: now.toISOString(),
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item";
}
