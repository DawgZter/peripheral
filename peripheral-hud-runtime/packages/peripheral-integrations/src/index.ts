import {
  type AgentEvent,
  type ApprovalRiskLevel,
  type AppMode,
  type Choice,
  type PeripheralSource,
  type PeripheralWidget,
  type SurfaceCommand,
  type SurfaceKind,
  type SurfaceLease,
} from "../../peripheral-protocol/src/index.js";

export type IntegrationStatus = "connected" | "configured" | "supported";

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

export type CredentialState = "missing" | "partial" | "configured";

export type AdapterRuntimeState = "cataloged" | "configured" | "live_ready";

export type IntegrationSupport = {
  kind: "sponsor" | "agent_cli";
  id: SponsorId | AgentCliId;
  name: string;
  status: IntegrationStatus;
  docs?: string;
  command?: string;
  credentialNames: string[];
  credentialMode: "externalized_runtime";
  configuredCredentialNames: string[];
  credentialState: CredentialState;
  configured: boolean;
  connected: boolean;
  supported: true;
  surfaceCount: number;
  connectionMode: "credential_bound_runtime";
  adapterState: AdapterRuntimeState;
  operationCount: number;
  runtimePath: string;
};

export type IntegrationSupportReport = {
  schema: "peripheral-integration-support-v1";
  generatedAt: string;
  totals: {
    integrations: number;
    connected: number;
    supported: number;
    configured: number;
    liveReady: number;
    credentialNames: number;
    operations: number;
    surfaceCapabilities: number;
  };
  integrations: IntegrationSupport[];
  note: string;
};

export type LiveAdapterOperation = {
  id: string;
  label: string;
  method: "GET" | "POST" | "STREAM" | "CLI";
  target: string;
  event: string;
  surface: SurfaceKind;
  risk: "low" | "medium" | "high";
  approval: "ambient" | "voice" | "voice_and_tap" | "phone_or_desktop";
};

export type LiveAdapter = {
  kind: "sponsor" | "agent_cli";
  id: SponsorId | AgentCliId;
  name: string;
  adapterStatus: "live_ready";
  connection: "credential_bound";
  credentials: string[];
  runtime: "phone_owned_agent_mode";
  dispatch: "brokered_surface_command";
  endpoint?: {
    baseUrl: string;
    auth: "bearer" | "basic" | "api_key_header" | "google_api_key";
  };
  cli?: {
    command: string;
    aliases: string[];
    sessionModel: AgentCliIntegration["sessionModel"];
  };
  operations: LiveAdapterOperation[];
};

export type LiveAdapterCatalog = {
  schema: "peripheral-live-adapter-catalog-v1";
  generatedAt: string;
  totals: {
    adapters: number;
    sponsorAdapters: number;
    agentCliAdapters: number;
    liveReady: number;
    operations: number;
  };
  adapters: LiveAdapter[];
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

export type ConnectedGlassesState = {
  schema: "peripheral-connected-state-v1";
  mode: AppMode;
  generatedAt: string;
  glasses: {
    connected: true;
    transport: "peripheral_phone_gateway";
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
    status: "connected",
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
    status: "connected",
    agentEvents: ["payment_intent_requires_action", "setup_intent_created", "receipt_available", "risk_review"],
    surfaces: [
      capability("stripe.card_hold", "Card-hold approval", "Shows refundable holds and requires explicit user confirmation.", "fullscreen", "medium"),
      capability("stripe.receipt", "Receipt glance", "Shows amount, merchant, status, and receipt action after an agent purchase.", "glance", "low"),
      capability("stripe.high_risk", "High-risk payment block", "Escalates high-risk payment actions to phone or desktop confirmation.", "pinned", "high"),
    ],
    notes: [
      "Low-risk receipts can be glance-only; payment methods and production charges require higher confirmation.",
      "Review surfaces are fully self-contained and can hand off to Stripe credentials when present.",
    ],
  },
  {
    id: "supermemory",
    name: "Supermemory",
    role: "Persistent memory and retrieval layer for agent context on the glasses.",
    docs: "https://docs.supermemory.ai/",
    env: ["SUPERMEMORY_API_KEY", "SUPERMEMORY_CONTAINER"],
    status: "connected",
    agentEvents: ["memory_save_requested", "memory_search_result", "profile_updated"],
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
    status: "connected",
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
    status: "connected",
    agentEvents: ["browser_step", "browser_waiting", "browser_submit_requested", "browser_result", "browser_error"],
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
    status: "connected",
    agentEvents: ["context_absorbed", "context_clustered", "summary_ready"],
    surfaces: [
      capability("sponge.digest", "Context digest", "Turns noisy agent/browser/call state into a short HUD digest.", "glance", "low"),
      capability("sponge.cluster", "Signal clusters", "Shows top grouped signals when multiple agents are active.", "glance", "low"),
      capability("sponge.redaction", "Redaction warning", "Flags potentially sensitive context before persistence.", "pinned", "medium"),
    ],
    notes: [
      "Sponge serves as the compression stage before long-lived memory or display.",
      "The checked-in adapter provides deterministic broker surfaces and credential-aware runtime handoff.",
    ],
  },
  {
    id: "gemini",
    name: "Gemini",
    role: "Multimodal broker reasoning, summarization, and structured HUD generation.",
    docs: "https://ai.google.dev/gemini-api/docs",
    env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    status: "connected",
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
  agentCli("openclaw", "OpenClaw", "openclaw", ["claw"], "Command interface: openclaw on PATH; auth is handled by the local CLI/runtime environment.", "pty", ["OPENCLAW_API_KEY"], "connected", [
    "Treats claw tasks as workspace sessions with terminal fallback and approval events.",
  ]),
  agentCli("claude_code", "Claude Code CLI", "claude", ["claude-code"], "Command interface: claude on PATH; auth is handled by the local CLI/runtime environment.", "tmux", ["ANTHROPIC_API_KEY"], "connected", [
    "PTY/tmux capture lets the phone app show normal terminal progress without owning the session.",
  ]),
  agentCli("pi", "Pi", "pi", ["inflection", "pi-cli"], "Command interface: pi-compatible adapter; auth is handled by the local CLI/runtime environment.", "adapter", ["PI_API_KEY"], "connected", [
    "Modeled as a conversational companion agent with voice-first reply surfaces.",
  ]),
  agentCli("opencode", "OpenCode", "opencode", ["oc"], "Command interface: opencode workspace PTY; auth is handled by the local CLI/runtime environment.", "pty", ["OPENCODE_API_KEY"], "connected", [
    "Maps OpenCode plan/apply/waiting states into generic AgentEvent objects.",
  ]),
  agentCli("gemini_cli", "Gemini CLI", "gemini", ["gemini-cli"], "Command interface: gemini stdio session; auth is handled by the local CLI/runtime environment.", "stdio", ["GEMINI_API_KEY", "GOOGLE_API_KEY"], "connected", [
    "Used for broker summaries, multimodal notes, and low-risk routing suggestions.",
  ]),
  agentCli("codex_cli", "Codex CLI", "codex", [], "Command interface: codex tmux session from the Mac broker workspace; auth is handled by the local CLI/runtime environment.", "tmux", ["OPENAI_API_KEY"], "connected", [
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

export function buildIntegrationSupportReport(env: EnvSnapshot = {}, now = new Date()): IntegrationSupportReport {
  const integrations: IntegrationSupport[] = [
    ...sponsorIntegrations.map((item) => supportForSponsor(item, env)),
    ...agentCliIntegrations.map((item) => supportForAgentCli(item, env)),
  ];
  return {
    schema: "peripheral-integration-support-v1",
    generatedAt: now.toISOString(),
    totals: {
      integrations: integrations.length,
      connected: integrations.filter((item) => item.connected).length,
      supported: integrations.filter((item) => item.supported).length,
      configured: integrations.filter((item) => item.configured).length,
      liveReady: integrations.filter((item) => item.adapterState === "live_ready").length,
      credentialNames: integrations.reduce((count, item) => count + item.credentialNames.length, 0),
      operations: integrations.reduce((count, item) => count + item.operationCount, 0),
      surfaceCapabilities: integrations.reduce((count, item) => count + item.surfaceCount, 0),
    },
    integrations,
    note: "Every listed adapter has operation metadata, credential-bound routing, and phone-owned surface dispatch; live runtime state is derived from credentials and secret values stay outside the repo.",
  };
}

export function buildLiveAdapterCatalog(now = new Date()): LiveAdapterCatalog {
  const adapters = [
    ...sponsorIntegrations.map(liveSponsorAdapter),
    ...agentCliIntegrations.map(liveAgentCliAdapter),
  ];
  return {
    schema: "peripheral-live-adapter-catalog-v1",
    generatedAt: now.toISOString(),
    totals: {
      adapters: adapters.length,
      sponsorAdapters: adapters.filter((adapter) => adapter.kind === "sponsor").length,
      agentCliAdapters: adapters.filter((adapter) => adapter.kind === "agent_cli").length,
      liveReady: adapters.filter((adapter) => adapter.adapterStatus === "live_ready").length,
      operations: adapters.reduce((count, adapter) => count + adapter.operations.length, 0),
    },
    adapters,
    note: "Live-ready adapters expose credential-bound API or CLI operations that route through the broker and phone-owned Agent Mode surface.",
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
        description: "Connected glasses runtime state, phone runtime, broker lease, and current widgets.",
      },
      {
        uri: "peripheral://integrations/sponsors",
        description: "Sponsor adapter capabilities and event names for AgentPhone, Stripe, Supermemory, AgentMail, Browser Use, Sponge, and Gemini.",
      },
      {
        uri: "peripheral://integrations/agent-clis",
        description: "Agent CLI adapter manifest for OpenClaw, Claude Code CLI, Pi, OpenCode, Gemini CLI, and Codex CLI.",
      },
      {
        uri: "peripheral://integrations/live-adapters",
        description: "Sponsor and agent CLI adapter operations with credential-bound entrypoints.",
      },
    ],
    tools: [
      mcpTool("peripheral.enter_agent_mode", "Ask the phone runtime to enter Agent Mode and grant the broker a fullscreen lease.", "low"),
      mcpTool("peripheral.show_widget", "Render a semantic widget on the glasses through the phone-owned renderer.", "low"),
      mcpTool("peripheral.request_approval", "Show a focused approval card with event_id, session_id, risk, and choices.", "medium"),
      mcpTool("peripheral.route_input", "Route voice/tap/head-pose input to the focused card, named agent, app mode, or default broker.", "medium"),
      mcpTool("peripheral.invoke_live_adapter", "Invoke a credential-bound sponsor or CLI adapter through broker policy.", "high"),
      mcpTool("peripheral.enforce_surface_policy", "Enforce semantic-surface routing for agent display requests.", "high"),
    ],
  };
}

export function buildBrokerTimeline(now = new Date()): BrokerTimeline {
  const connected = buildConnectedGlassesState(now);
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
      { label: "Display command policy active", checked: true, status: "safe" },
    ],
    footer: "Phone gateway connected / broker policy active",
    source: "peripheral-integrations",
    created_at: now.toISOString(),
  };
}

export function buildApprovalEvent(sourceId: SponsorId | AgentCliId, sessionId: string, title: string, summary: string, now = new Date(), risk: ApprovalRiskLevel = "medium"): AgentEvent {
  const source = sourceFor(sourceId, sessionId);
  return {
    kind: "approval_required",
    id: "approval-" + slug(sourceId + "-" + sessionId),
    source,
    session_id: sessionId,
    title,
    summary,
    risk,
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

export function buildConnectedGlassesState(now = new Date()): ConnectedGlassesState {
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
      transport: "peripheral_phone_gateway",
      display: "540x280_2bpp",
      batteryPercent: 87,
      rssi: -48,
      firmware: "peripheral-public-runtime",
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
      reason: "Connected-glasses Agent Mode walkthrough.",
      created_at: now.toISOString(),
    })),
    widgets,
  };
}

export function buildAgentModeDossier(now = new Date()): Record<string, unknown> {
  const summary = buildIntegrationSummary();
  const connected = buildConnectedGlassesState(now);
  const supportReport = buildIntegrationSupportReport({}, now);
  const liveAdapters = buildLiveAdapterCatalog(now);
  return {
    schema: "peripheral-agent-mode-dossier-v1",
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
    liveAdapters,
    connectedGlasses: connected,
    supportReport,
    mcpManifest: buildPeripheralMcpManifest(now),
    brokerTimeline: buildBrokerTimeline(now),
    safety: [
      "Agents emit semantic widgets, never raw BLE bytes.",
      "Phone app owns display leases and final rendering.",
      "Medium and high risk actions are approval-gated.",
      "Runtime state uses the phone gateway path and semantic display commands.",
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
  return { id, label: id, kind: "system", session_id: sessionId };
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

function liveSponsorAdapter(item: SponsorIntegration): LiveAdapter {
  return {
    kind: "sponsor",
    id: item.id,
    name: item.name,
    adapterStatus: "live_ready",
    connection: "credential_bound",
    credentials: item.env,
    runtime: "phone_owned_agent_mode",
    dispatch: "brokered_surface_command",
    endpoint: sponsorEndpoint(item.id),
    operations: sponsorOperations(item),
  };
}

function liveAgentCliAdapter(item: AgentCliIntegration): LiveAdapter {
  return {
    kind: "agent_cli",
    id: item.id,
    name: item.name,
    adapterStatus: "live_ready",
    connection: "credential_bound",
    credentials: item.env,
    runtime: "phone_owned_agent_mode",
    dispatch: "brokered_surface_command",
    cli: {
      command: item.command,
      aliases: item.aliases,
      sessionModel: item.sessionModel,
    },
    operations: [
      adapterOperation(item.id + ".session.start", "Start agent session", "CLI", item.command + " <task>", "session_started", "glance", "low", "ambient"),
      adapterOperation(item.id + ".session.progress", "Stream session progress", "STREAM", item.command + " stdout", "session_progress", "glance", "low", "ambient"),
      adapterOperation(item.id + ".approval.resolve", "Resolve approval request", "CLI", item.command + " approval", "approval_required", "fullscreen", "medium", "voice_and_tap"),
      adapterOperation(item.id + ".terminal.fallback", "Open terminal fallback", "CLI", item.command + " tty", "session_waiting", "pinned", "medium", "voice_and_tap"),
    ],
  };
}

function sponsorEndpoint(id: SponsorId): LiveAdapter["endpoint"] {
  switch (id) {
    case "agentphone":
      return { baseUrl: "https://api.agentphone.com/v1", auth: "bearer" };
    case "stripe":
      return { baseUrl: "https://api.stripe.com/v1", auth: "bearer" };
    case "supermemory":
      return { baseUrl: "https://api.supermemory.ai/v1", auth: "bearer" };
    case "agentmail":
      return { baseUrl: "https://api.agentmail.to/v1", auth: "bearer" };
    case "browser_use":
      return { baseUrl: "https://api.browser-use.com/v1", auth: "bearer" };
    case "sponge":
      return { baseUrl: "https://api.sponge.ai/v1", auth: "api_key_header" };
    case "gemini":
      return { baseUrl: "https://generativelanguage.googleapis.com/v1beta", auth: "google_api_key" };
  }
}

function sponsorOperations(item: SponsorIntegration): LiveAdapterOperation[] {
  switch (item.id) {
    case "agentphone":
      return [
        adapterOperation("agentphone.calls.create", "Create coordinated call", "POST", "/calls", "call_started", "glance", "low", "voice"),
        adapterOperation("agentphone.calls.status", "Stream call status", "STREAM", "/calls/{call_id}/events", "call_connected", "glance", "low", "ambient"),
        adapterOperation("agentphone.calls.handoff", "Request human takeover", "POST", "/calls/{call_id}/handoff", "human_takeover_requested", "fullscreen", "medium", "voice_and_tap"),
      ];
    case "stripe":
      return [
        adapterOperation("stripe.payment_intents.create", "Create payment intent", "POST", "/payment_intents", "payment_intent_requires_action", "fullscreen", "medium", "voice_and_tap"),
        adapterOperation("stripe.setup_intents.create", "Create setup intent", "POST", "/setup_intents", "setup_intent_created", "fullscreen", "medium", "voice_and_tap"),
        adapterOperation("stripe.receipts.fetch", "Fetch receipt", "GET", "/charges/{charge_id}", "receipt_available", "glance", "low", "ambient"),
        adapterOperation("stripe.risk.escalate", "Escalate risk policy", "POST", "/payment_intents/{payment_intent_id}", "risk_review", "pinned", "high", "phone_or_desktop"),
      ];
    case "supermemory":
      return [
        adapterOperation("supermemory.memories.search", "Search memory", "POST", "/memories/search", "memory_search_result", "glance", "low", "ambient"),
        adapterOperation("supermemory.memories.create", "Create memory", "POST", "/memories", "memory_save_requested", "fullscreen", "medium", "voice_and_tap"),
        adapterOperation("supermemory.profile.update", "Update profile context", "POST", "/profiles/{profile_id}", "profile_updated", "tiny_hud", "low", "voice"),
      ];
    case "agentmail":
      return [
        adapterOperation("agentmail.inbox.list", "List agent inbox", "GET", "/inboxes/{inbox}/messages", "mail_received", "tiny_hud", "low", "ambient"),
        adapterOperation("agentmail.drafts.create", "Create outbound draft", "POST", "/inboxes/{inbox}/drafts", "draft_ready", "fullscreen", "medium", "voice_and_tap"),
        adapterOperation("agentmail.messages.send", "Send approved reply", "POST", "/inboxes/{inbox}/messages", "reply_sent", "fullscreen", "medium", "voice_and_tap"),
        adapterOperation("agentmail.codes.extract", "Pin verification code", "GET", "/inboxes/{inbox}/verification-codes", "verification_code_found", "pinned", "medium", "voice_and_tap"),
      ];
    case "browser_use":
      return [
        adapterOperation("browser_use.sessions.create", "Create browser session", "POST", "/sessions", "browser_step", "glance", "low", "ambient"),
        adapterOperation("browser_use.sessions.events", "Stream browser events", "STREAM", "/sessions/{session_id}/events", "browser_step", "glance", "low", "ambient"),
        adapterOperation("browser_use.forms.submit", "Submit sensitive browser action", "POST", "/sessions/{session_id}/actions", "browser_submit_requested", "fullscreen", "high", "phone_or_desktop"),
        adapterOperation("browser_use.evidence.fetch", "Fetch browser evidence", "GET", "/sessions/{session_id}/evidence", "browser_result", "glance", "low", "ambient"),
      ];
    case "sponge":
      return [
        adapterOperation("sponge.context.absorb", "Absorb context", "POST", "/contexts", "context_absorbed", "glance", "low", "ambient"),
        adapterOperation("sponge.context.cluster", "Cluster signals", "POST", "/contexts/{context_id}/clusters", "context_clustered", "glance", "low", "ambient"),
        adapterOperation("sponge.summaries.create", "Create context summary", "POST", "/summaries", "summary_ready", "glance", "low", "ambient"),
      ];
    case "gemini":
      return [
        adapterOperation("gemini.models.generate", "Generate broker summary", "POST", "/models/gemini-2.5-flash:generateContent", "broker_summary", "glance", "low", "ambient"),
        adapterOperation("gemini.models.vision", "Run visual reasoning", "POST", "/models/gemini-2.5-pro:generateContent", "visual_reasoning_result", "fullscreen", "medium", "voice_and_tap"),
        adapterOperation("gemini.routing.decide", "Decide route", "POST", "/models/gemini-2.5-flash:generateContent", "route_decision", "tiny_hud", "low", "ambient"),
      ];
  }
}

function adapterOperation(
  id: string,
  label: string,
  method: LiveAdapterOperation["method"],
  target: string,
  event: string,
  surface: SurfaceKind,
  risk: Capability["risk"],
  approval: LiveAdapterOperation["approval"],
): LiveAdapterOperation {
  return { id, label, method, target, event, surface, risk, approval };
}

function supportForSponsor(item: SponsorIntegration, env: EnvSnapshot): IntegrationSupport {
  const operations = sponsorOperations(item);
  const credentials = credentialSnapshot(item.env, env);
  return {
    kind: "sponsor",
    id: item.id,
    name: item.name,
    status: item.status,
    docs: item.docs,
    credentialNames: item.env,
    credentialMode: "externalized_runtime",
    configuredCredentialNames: credentials.configured,
    missingCredentialNames: credentials.missing,
    credentialState: credentials.state,
    configured: credentials.configured.length > 0,
    connected: credentials.adapterState === "live_ready",
    supported: true,
    surfaceCount: item.surfaces.length,
    connectionMode: "credential_bound_runtime",
    adapterState: credentials.adapterState,
    operationCount: operations.length,
    runtimePath: "Use " + item.name + " through the broker workflow and phone-owned surface runtime.",
  };
}

function supportForAgentCli(item: AgentCliIntegration, env: EnvSnapshot): IntegrationSupport {
  const operationCount = 4;
  const credentials = credentialSnapshot(item.env, env);
  return {
    kind: "agent_cli",
    id: item.id,
    name: item.name,
    status: item.status,
    command: item.command,
    credentialNames: item.env,
    credentialMode: "externalized_runtime",
    configuredCredentialNames: credentials.configured,
    missingCredentialNames: credentials.missing,
    credentialState: credentials.state,
    configured: credentials.configured.length > 0,
    connected: credentials.adapterState === "live_ready",
    supported: true,
    surfaceCount: item.surfaces.length,
    connectionMode: "credential_bound_runtime",
    adapterState: credentials.adapterState,
    operationCount,
    runtimePath: "Route " + item.name + " through the agent bridge using " + item.sessionModel + " session semantics.",
  };
}

function credentialSnapshot(names: string[], env: EnvSnapshot): {
  configured: string[];
  missing: string[];
  state: CredentialState;
  adapterState: AdapterRuntimeState;
} {
  const configured = names.filter((name) => Boolean(env[name]));
  const missing = names.filter((name) => !env[name]);
  const state: CredentialState = configured.length === 0 ? "missing" : missing.length === 0 ? "configured" : "partial";
  return {
    configured,
    missing,
    state,
    adapterState: hasPrimaryCredential(names, env) ? "live_ready" : configured.length > 0 ? "configured" : "cataloged",
  };
}

function hasPrimaryCredential(names: string[], env: EnvSnapshot): boolean {
  if (names.length === 0) return true;
  if (names.some((name) => name.endsWith("_API_KEY") && env[name])) return true;
  return Boolean(env[names[0]]);
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
