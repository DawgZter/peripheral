export const PERIPHERAL_DISPLAY = {
  width: 540,
  height: 280,
  bitsPerPixel: 2,
  rawBytes: 37_800,
  setupProfile: "full-panel",
  imagePrefixHex: "fe000000",
  route: "full_panel_image",
} as const;

export const MAP_WIDGET_DISPLAY = {
  width: 304,
  height: 179,
  bitsPerPixel: 2,
  rawBytes: 13_604,
  setupProfile: "standard",
  imagePrefixHex: "00000080",
  route: "captured_map_widget",
} as const;

export const WIDGET_TYPES = [
  "live_call",
  "strategy_card",
  "people_list",
  "person_detail",
  "approval_card",
  "status_icon",
  "generic_card",
  "table",
  "checklist",
  "terminal",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

export const APP_MODES = [
  "current_stage",
  "ambient_agent_hud",
  "agent_mode",
  "pairing",
  "debug",
  "system",
] as const;

export type AppMode = (typeof APP_MODES)[number];

export const SURFACE_OWNERS = [
  "current_stage",
  "agent_mode",
  "debug",
  "system",
  "broker",
  "agent",
  "sponsor",
] as const;

export type SurfaceOwner = (typeof SURFACE_OWNERS)[number];

export const SURFACE_PRIORITIES = ["ambient", "normal", "high", "urgent"] as const;

export type SurfacePriority = (typeof SURFACE_PRIORITIES)[number];

export const SURFACE_KINDS = ["tiny_hud", "glance", "fullscreen", "pinned"] as const;

export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export const SURFACE_COMMAND_KINDS = [
  "show_status_icon",
  "show_card",
  "show_widget",
  "update_widget",
  "clear_surface",
  "enter_agent_mode",
  "exit_agent_mode",
] as const;

export type SurfaceCommandKind = (typeof SURFACE_COMMAND_KINDS)[number];

export const INPUT_EVENT_KINDS = [
  "voice_text",
  "tap",
  "double_tap",
  "long_press",
  "head_pose",
  "look_up",
  "look_down",
  "app_button",
  "dismiss",
] as const;

export type InputEventKind = (typeof INPUT_EVENT_KINDS)[number];

export const AGENT_EVENT_KINDS = [
  "approval_required",
  "session_started",
  "session_waiting",
  "session_progress",
  "session_completed",
  "session_stuck",
  "session_error",
] as const;

export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

export const APPROVAL_RISK_LEVELS = ["low", "medium", "high"] as const;

export type ApprovalRiskLevel = (typeof APPROVAL_RISK_LEVELS)[number];

export const HUD_RUNTIME_STATES = [
  "blank",
  "agent_hud",
  "active_agent",
  "terminal",
  "dynamic_result",
  "error",
] as const;

export type HudRuntimeState = (typeof HUD_RUNTIME_STATES)[number];

export const AGENT_STATUSES = [
  "idle",
  "launching",
  "running",
  "waiting",
  "needs_attention",
  "completed",
  "error",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const PERIPHERAL_AGENT_MODE_PROTOCOL = "peripheral.agent_mode.v1" as const;

export const PERIPHERAL_SOURCE_KINDS = [
  "agent_cli",
  "sponsor",
  "system",
  "walkthrough",
  "local_tool",
  "bridge",
] as const;

export type PeripheralSourceKind = (typeof PERIPHERAL_SOURCE_KINDS)[number];

export const SOURCE_TRUST_LEVELS = ["mock", "local", "verified", "remote"] as const;

export type SourceTrustLevel = (typeof SOURCE_TRUST_LEVELS)[number];

export const AGENT_SURFACE_CAPABILITIES = [
  "voice_transcript",
  "hud_render",
  "approval_gate",
  "tool_call",
  "memory_recall",
  "payment_intent",
  "email_draft",
  "browser_session",
  "agent_handoff",
  "file_context",
  "live_status",
  "scripted_replay",
] as const;

export type AgentSurfaceCapability = (typeof AGENT_SURFACE_CAPABILITIES)[number];

export const USER_DECISION_KINDS = ["approval_decision", "dismiss", "details", "reply"] as const;

export type UserDecisionKind = (typeof USER_DECISION_KINDS)[number];

export const USER_DECISIONS = ["approve", "deny", "details", "dismiss", "reply"] as const;

export type UserDecisionValue = (typeof USER_DECISIONS)[number];

export const CONFIRMATION_LEVELS = ["voice", "tap", "voice_and_tap", "phone", "desktop"] as const;

export type ConfirmationLevel = (typeof CONFIRMATION_LEVELS)[number];

export const PROTOCOL_MESSAGE_KINDS = [
  "surface_lease",
  "surface_command",
  "input_event",
  "agent_event",
  "user_decision",
] as const;

export type ProtocolMessageKind = (typeof PROTOCOL_MESSAGE_KINDS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SourceReference = {
  label: string;
  uri?: string;
  kind?: "log" | "artifact" | "command" | "url" | "note";
};

export type PeripheralSource = {
  id: string;
  label: string;
  kind: PeripheralSourceKind;
  vendor?: string;
  adapter_id?: string;
  command?: string;
  model?: string;
  trust?: SourceTrustLevel;
  session_id?: string;
  capabilities?: AgentSurfaceCapability[];
  references?: SourceReference[];
  metadata?: Record<string, JsonValue>;
};

export type SurfaceLease = {
  id: string;
  owner: SurfaceOwner;
  priority: SurfacePriority;
  surface: SurfaceKind;
  mode: AppMode;
  interruptible: boolean;
  reason: string;
  source?: PeripheralSource;
  requested_capabilities?: AgentSurfaceCapability[];
  agent_session_id?: string;
  ttl_ms?: number;
  expires_at?: string;
  created_at?: string;
};

export type SurfaceCommand = {
  kind: SurfaceCommandKind;
  id: string;
  mode: AppMode;
  surface: SurfaceKind;
  lease?: SurfaceLease;
  widget?: PeripheralWidget;
  card?: PeripheralWidget;
  source?: PeripheralSource;
  lease_id?: string;
  sequence?: number;
  decision_required?: boolean;
  ttl_ms?: number;
  reason?: string;
  created_at?: string;
};

export type InputEvent = {
  kind: InputEventKind;
  id: string;
  mode: AppMode;
  source?: PeripheralSource;
  surface?: SurfaceKind;
  focused_card_id?: string;
  focused_widget_id?: string;
  text?: string;
  value?: string | number | boolean;
  head_pose?: {
    pitch?: number;
    yaw?: number;
    roll?: number;
  };
  metadata?: Record<string, JsonValue>;
  timestamp: string;
};

export type AgentEvent = {
  kind: AgentEventKind;
  id: string;
  source: PeripheralSource;
  session_id: string;
  title: string;
  summary?: string;
  status?: AgentStatus;
  risk?: ApprovalRiskLevel;
  progress?: number;
  capabilities?: AgentSurfaceCapability[];
  references?: SourceReference[];
  choices?: Choice[];
  widget?: PeripheralWidget;
  created_at: string;
};

export type UserDecision = {
  kind: UserDecisionKind;
  event_id: string;
  session_id: string;
  decision: UserDecisionValue;
  confirmation_level: ConfirmationLevel;
  source?: PeripheralSource;
  choice_id?: string;
  reason?: string;
  text?: string;
  metadata?: Record<string, JsonValue>;
  timestamp: string;
};

export type ProtocolPayloadByKind = {
  surface_lease: SurfaceLease;
  surface_command: SurfaceCommand;
  input_event: InputEvent;
  agent_event: AgentEvent;
  user_decision: UserDecision;
};

export type PeripheralProtocolEnvelope<K extends ProtocolMessageKind = ProtocolMessageKind> = {
  protocol: typeof PERIPHERAL_AGENT_MODE_PROTOCOL;
  kind: K;
  id: string;
  source?: PeripheralSource;
  trace_id?: string;
  causation_id?: string;
  payload: ProtocolPayloadByKind[K];
  created_at: string;
};

export type Choice = {
  id?: string;
  label: string;
  tone?: "primary" | "secondary" | "danger";
};

export type PersonSummary = {
  name: string;
  role?: string;
  company?: string;
  reason?: string;
  score?: string | number;
  image?: string;
};

export type TranscriptBubble = {
  speaker: "agent" | "other" | "user" | string;
  text: string;
};

export type TableRow = string[] | Record<string, string | number | boolean | null | undefined>;

export type ChecklistItem = {
  label: string;
  checked?: boolean;
  status?: AgentStatus | string;
};

export type PeripheralWidget = {
  id: string;
  type: WidgetType;
  title: string;
  status?: string;
  body?: string;
  bullets?: string[];
  footer?: string;
  source?: string;
  created_at?: string;
  icon?: string;
  left_image?: string;
  primary?: string;
  action?: string;
  choices?: Choice[];
  transcript?: TranscriptBubble[];
  facts?: string[];
  player_hand?: string;
  dealer_card?: string;
  people?: PersonSummary[];
  name?: string;
  role?: string;
  company?: string;
  columns?: string[];
  rows?: TableRow[];
  items?: ChecklistItem[];
  terminal?: string[];
  prompt?: string;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export function validateSource(input: unknown, path = "$"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path, message: "Source must be a JSON object." }];
  }
  requireStringAt(input, "id", path, issues);
  requireStringAt(input, "label", path, issues);
  requireOneOf(input.kind, PERIPHERAL_SOURCE_KINDS, path + ".kind", "source kind", issues);
  validateOptionalString(input, "vendor", path, issues);
  validateOptionalString(input, "adapter_id", path, issues);
  validateOptionalString(input, "command", path, issues);
  validateOptionalString(input, "model", path, issues);
  validateOptionalString(input, "session_id", path, issues);
  if (input.trust !== undefined) {
    requireOneOf(input.trust, SOURCE_TRUST_LEVELS, path + ".trust", "source trust", issues);
  }
  validateKnownStringArray(input.capabilities, AGENT_SURFACE_CAPABILITIES, path + ".capabilities", "capability", issues);
  validateSourceReferences(input.references, path + ".references", issues);
  validateMetadata(input.metadata, path + ".metadata", issues);
  return issues;
}

export function validateSurfaceLease(input: unknown, path = "$"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path, message: "Surface lease must be a JSON object." }];
  }
  requireStringAt(input, "id", path, issues);
  requireOneOf(input.owner, SURFACE_OWNERS, path + ".owner", "surface owner", issues);
  requireOneOf(input.priority, SURFACE_PRIORITIES, path + ".priority", "surface priority", issues);
  requireOneOf(input.surface, SURFACE_KINDS, path + ".surface", "surface", issues);
  requireOneOf(input.mode, APP_MODES, path + ".mode", "app mode", issues);
  requireBoolean(input.interruptible, path + ".interruptible", "interruptible", issues);
  requireStringAt(input, "reason", path, issues);
  validateOptionalSource(input.source, path + ".source", issues);
  validateKnownStringArray(input.requested_capabilities, AGENT_SURFACE_CAPABILITIES, path + ".requested_capabilities", "capability", issues);
  validateOptionalString(input, "agent_session_id", path, issues);
  validateOptionalNumber(input, "ttl_ms", path, issues);
  validateOptionalString(input, "expires_at", path, issues);
  validateOptionalString(input, "created_at", path, issues);
  return issues;
}

export function validateSurfaceCommand(input: unknown, path = "$"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path, message: "Surface command must be a JSON object." }];
  }
  requireOneOf(input.kind, SURFACE_COMMAND_KINDS, path + ".kind", "surface command kind", issues);
  requireStringAt(input, "id", path, issues);
  requireOneOf(input.mode, APP_MODES, path + ".mode", "app mode", issues);
  requireOneOf(input.surface, SURFACE_KINDS, path + ".surface", "surface", issues);
  if (input.lease !== undefined) {
    issues.push(...validateSurfaceLease(input.lease, path + ".lease"));
  }
  if (input.widget !== undefined) {
    issues.push(...prefixIssues(path + ".widget", validateWidget(input.widget)));
  }
  if (input.card !== undefined) {
    issues.push(...prefixIssues(path + ".card", validateWidget(input.card)));
  }
  validateOptionalSource(input.source, path + ".source", issues);
  validateOptionalString(input, "lease_id", path, issues);
  validateOptionalNumber(input, "sequence", path, issues);
  validateOptionalBoolean(input, "decision_required", path, issues);
  validateOptionalNumber(input, "ttl_ms", path, issues);
  validateOptionalString(input, "reason", path, issues);
  validateOptionalString(input, "created_at", path, issues);
  return issues;
}

export function validateInputEvent(input: unknown, path = "$"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path, message: "Input event must be a JSON object." }];
  }
  requireOneOf(input.kind, INPUT_EVENT_KINDS, path + ".kind", "input event kind", issues);
  requireStringAt(input, "id", path, issues);
  requireOneOf(input.mode, APP_MODES, path + ".mode", "app mode", issues);
  validateOptionalSource(input.source, path + ".source", issues);
  if (input.surface !== undefined) {
    requireOneOf(input.surface, SURFACE_KINDS, path + ".surface", "surface", issues);
  }
  validateOptionalString(input, "focused_card_id", path, issues);
  validateOptionalString(input, "focused_widget_id", path, issues);
  validateOptionalString(input, "text", path, issues);
  if (input.kind === "voice_text" && !isString(input.text)) {
    issues.push({ path: path + ".text", message: "voice_text events require text." });
  }
  if (input.value !== undefined && !isScalar(input.value)) {
    issues.push({ path: path + ".value", message: "value must be a scalar when provided." });
  }
  validateHeadPose(input.head_pose, path + ".head_pose", issues);
  validateMetadata(input.metadata, path + ".metadata", issues);
  requireStringAt(input, "timestamp", path, issues);
  return issues;
}

export function validateAgentEvent(input: unknown, path = "$"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path, message: "Agent event must be a JSON object." }];
  }
  requireOneOf(input.kind, AGENT_EVENT_KINDS, path + ".kind", "agent event kind", issues);
  requireStringAt(input, "id", path, issues);
  issues.push(...validateSource(input.source, path + ".source"));
  requireStringAt(input, "session_id", path, issues);
  requireStringAt(input, "title", path, issues);
  validateOptionalString(input, "summary", path, issues);
  if (input.status !== undefined) {
    requireOneOf(input.status, AGENT_STATUSES, path + ".status", "agent status", issues);
  }
  if (input.risk !== undefined) {
    requireOneOf(input.risk, APPROVAL_RISK_LEVELS, path + ".risk", "approval risk", issues);
  }
  if (input.progress !== undefined) {
    if (typeof input.progress !== "number" || !Number.isFinite(input.progress) || input.progress < 0 || input.progress > 1) {
      issues.push({ path: path + ".progress", message: "progress must be a number between 0 and 1." });
    }
  }
  validateKnownStringArray(input.capabilities, AGENT_SURFACE_CAPABILITIES, path + ".capabilities", "capability", issues);
  validateSourceReferences(input.references, path + ".references", issues);
  if (input.choices !== undefined) {
    validateChoices(input.choices, issues, path + ".choices");
  }
  if (input.widget !== undefined) {
    issues.push(...prefixIssues(path + ".widget", validateWidget(input.widget)));
  }
  requireStringAt(input, "created_at", path, issues);
  return issues;
}

export function validateUserDecision(input: unknown, path = "$"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path, message: "User decision must be a JSON object." }];
  }
  requireOneOf(input.kind, USER_DECISION_KINDS, path + ".kind", "user decision kind", issues);
  requireStringAt(input, "event_id", path, issues);
  requireStringAt(input, "session_id", path, issues);
  requireOneOf(input.decision, USER_DECISIONS, path + ".decision", "decision", issues);
  requireOneOf(input.confirmation_level, CONFIRMATION_LEVELS, path + ".confirmation_level", "confirmation level", issues);
  validateOptionalSource(input.source, path + ".source", issues);
  validateOptionalString(input, "choice_id", path, issues);
  validateOptionalString(input, "reason", path, issues);
  validateOptionalString(input, "text", path, issues);
  validateMetadata(input.metadata, path + ".metadata", issues);
  requireStringAt(input, "timestamp", path, issues);
  return issues;
}

export function validateProtocolEnvelope(input: unknown, path = "$"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path, message: "Protocol envelope must be a JSON object." }];
  }
  if (input.protocol !== PERIPHERAL_AGENT_MODE_PROTOCOL) {
    issues.push({ path: path + ".protocol", message: "protocol must be " + PERIPHERAL_AGENT_MODE_PROTOCOL + "." });
  }
  requireOneOf(input.kind, PROTOCOL_MESSAGE_KINDS, path + ".kind", "protocol message kind", issues);
  requireStringAt(input, "id", path, issues);
  validateOptionalSource(input.source, path + ".source", issues);
  validateOptionalString(input, "trace_id", path, issues);
  validateOptionalString(input, "causation_id", path, issues);
  requireStringAt(input, "created_at", path, issues);
  if (!isRecord(input.payload)) {
    issues.push({ path: path + ".payload", message: "payload is required and must be a JSON object." });
    return issues;
  }
  switch (input.kind) {
    case "surface_lease":
      issues.push(...validateSurfaceLease(input.payload, path + ".payload"));
      break;
    case "surface_command":
      issues.push(...validateSurfaceCommand(input.payload, path + ".payload"));
      break;
    case "input_event":
      issues.push(...validateInputEvent(input.payload, path + ".payload"));
      break;
    case "agent_event":
      issues.push(...validateAgentEvent(input.payload, path + ".payload"));
      break;
    case "user_decision":
      issues.push(...validateUserDecision(input.payload, path + ".payload"));
      break;
  }
  return issues;
}

export function assertSource(input: unknown): PeripheralSource {
  assertValid(validateSource(input));
  return input as PeripheralSource;
}

export function assertSurfaceLease(input: unknown): SurfaceLease {
  assertValid(validateSurfaceLease(input));
  return input as SurfaceLease;
}

export function assertSurfaceCommand(input: unknown): SurfaceCommand {
  assertValid(validateSurfaceCommand(input));
  return input as SurfaceCommand;
}

export function assertInputEvent(input: unknown): InputEvent {
  assertValid(validateInputEvent(input));
  return input as InputEvent;
}

export function assertAgentEvent(input: unknown): AgentEvent {
  assertValid(validateAgentEvent(input));
  return input as AgentEvent;
}

export function assertUserDecision(input: unknown): UserDecision {
  assertValid(validateUserDecision(input));
  return input as UserDecision;
}

export function assertProtocolEnvelope<K extends ProtocolMessageKind>(input: PeripheralProtocolEnvelope<K>): PeripheralProtocolEnvelope<K>;
export function assertProtocolEnvelope(input: unknown): PeripheralProtocolEnvelope;
export function assertProtocolEnvelope(input: unknown): PeripheralProtocolEnvelope {
  assertValid(validateProtocolEnvelope(input));
  return input as PeripheralProtocolEnvelope;
}

export function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === "string" && (WIDGET_TYPES as readonly string[]).includes(value);
}

export function validateWidget(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: "$", message: "Widget must be a JSON object." }];
  }

  const type = input.type;
  if (!isWidgetType(type)) {
    issues.push({
      path: "$.type",
      message: `Unknown widget type ${JSON.stringify(type)}. Use one of: ${WIDGET_TYPES.join(", ")}.`,
    });
    return issues;
  }

  requireString(input, "id", issues);
  requireString(input, "title", issues);

  switch (type) {
    case "live_call":
      requireArray(input, "transcript", issues, false);
      break;
    case "strategy_card":
      requireString(input, "player_hand", issues);
      requireString(input, "dealer_card", issues);
      requireString(input, "action", issues);
      break;
    case "people_list":
      requireArray(input, "people", issues, true);
      break;
    case "person_detail":
      if (!isString(input.name) && !isString(input.title)) {
        issues.push({ path: "$.name", message: "person_detail requires name or title." });
      }
      break;
    case "approval_card":
      requireArray(input, "choices", issues, true);
      break;
    case "status_icon":
      if (!isString(input.status) && !isString(input.body)) {
        issues.push({ path: "$.status", message: "status_icon requires status or body." });
      }
      break;
    case "generic_card":
      if (!isString(input.body) && !Array.isArray(input.bullets)) {
        issues.push({ path: "$.body", message: "generic_card requires body or bullets." });
      }
      break;
    case "table":
      requireArray(input, "columns", issues, true);
      requireArray(input, "rows", issues, true);
      break;
    case "checklist":
      if (!Array.isArray(input.items) && !Array.isArray(input.bullets)) {
        issues.push({ path: "$.items", message: "checklist requires items or bullets." });
      }
      break;
    case "terminal":
      if (!Array.isArray(input.terminal) && !isString(input.body)) {
        issues.push({ path: "$.terminal", message: "terminal requires terminal lines or body." });
      }
      break;
  }

  if (input.bullets !== undefined && !arrayOfStrings(input.bullets)) {
    issues.push({ path: "$.bullets", message: "bullets must be an array of strings." });
  }
  if (input.facts !== undefined && !arrayOfStrings(input.facts)) {
    issues.push({ path: "$.facts", message: "facts must be an array of strings." });
  }
  if (input.transcript !== undefined && !Array.isArray(input.transcript)) {
    issues.push({ path: "$.transcript", message: "transcript must be an array." });
  }
  if (input.terminal !== undefined && !arrayOfStrings(input.terminal)) {
    issues.push({ path: "$.terminal", message: "terminal must be an array of strings." });
  }
  validateTranscript(input.transcript, issues);
  validatePeople(input.people, issues);
  validateChoices(input.choices, issues);
  validateTable(input.columns, input.rows, issues);
  validateChecklistItems(input.items, issues);

  return issues;
}

export function assertWidget(input: unknown): PeripheralWidget {
  const issues = validateWidget(input);
  if (issues.length > 0) {
    const message = issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
    throw new Error(message);
  }
  return normalizeWidget(input as PeripheralWidget);
}

export function normalizeWidget(widget: PeripheralWidget): PeripheralWidget {
  return {
    ...widget,
    id: cleanText(widget.id, 80),
    title: cleanText(widget.title, 80),
    status: optionalText(widget.status, 40),
    body: optionalText(widget.body, 300),
    footer: optionalText(widget.footer, 80),
    source: optionalText(widget.source, 80),
    prompt: optionalText(widget.prompt, 80),
    primary: optionalText(widget.primary, 40),
    action: optionalText(widget.action, 40),
    player_hand: optionalText(widget.player_hand, 40),
    dealer_card: optionalText(widget.dealer_card, 40),
    name: optionalText(widget.name, 80),
    role: optionalText(widget.role, 80),
    company: optionalText(widget.company, 80),
    created_at: widget.created_at || new Date().toISOString(),
    bullets: widget.bullets?.map((item) => cleanText(item, 90)).slice(0, 6),
    facts: widget.facts?.map((item) => cleanText(item, 90)).slice(0, 6),
    transcript: widget.transcript?.map((item) => ({
      speaker: cleanText(item.speaker || "agent", 20),
      text: cleanText(item.text || "", 130),
    })).slice(-3),
    people: widget.people?.map((person) => ({
      name: cleanText(person.name, 60),
      role: optionalText(person.role, 50),
      company: optionalText(person.company, 50),
      reason: optionalText(person.reason, 80),
      score: person.score,
      image: optionalText(person.image, 120),
    })).slice(0, 3),
    choices: widget.choices?.map((choice) => ({
      id: optionalText(choice.id, 40),
      label: cleanText(choice.label, 40),
      tone: choice.tone,
    })).slice(0, 3),
    columns: widget.columns?.map((item) => cleanText(item, 24)).slice(0, 4),
    rows: normalizeRows(widget.rows)?.slice(0, 5),
    items: normalizeChecklistItems(widget.items, widget.bullets)?.slice(0, 6),
    terminal: widget.terminal?.map((item) => cleanText(item, 160)).slice(-12),
  };
}

export function cleanText(value: unknown, maxChars = 120): string {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}

function optionalText(value: unknown, maxChars: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = cleanText(value, maxChars);
  return text ? text : undefined;
}

function requireString(input: Record<string, unknown>, key: string, issues: ValidationIssue[]): void {
  if (!isString(input[key])) {
    issues.push({ path: `$.${key}`, message: `${key} is required and must be a string.` });
  }
}

function requireArray(input: Record<string, unknown>, key: string, issues: ValidationIssue[], nonEmpty: boolean): void {
  if (!Array.isArray(input[key])) {
    issues.push({ path: `$.${key}`, message: `${key} is required and must be an array.` });
  } else if (nonEmpty && (input[key] as unknown[]).length === 0) {
    issues.push({ path: `$.${key}`, message: `${key} must not be empty.` });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function arrayOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertValid(issues: ValidationIssue[]): void {
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  }
}

function prefixIssues(path: string, issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: path + (issue.path === "$" ? "" : issue.path.slice(1)),
    message: issue.message,
  }));
}

function requireStringAt(input: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (!isString(input[key])) {
    issues.push({ path: `${path}.${key}`, message: `${key} is required and must be a string.` });
  }
}

function requireBoolean(value: unknown, path: string, label: string, issues: ValidationIssue[]): void {
  if (typeof value !== "boolean") {
    issues.push({ path, message: `${label} is required and must be a boolean.` });
  }
}

function requireOneOf(value: unknown, allowed: readonly string[], path: string, label: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({ path, message: `${label} must be one of: ${allowed.join(", ")}.` });
  }
}

function validateOptionalString(input: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (input[key] !== undefined && typeof input[key] !== "string") {
    issues.push({ path: `${path}.${key}`, message: `${key} must be a string when provided.` });
  }
}

function validateOptionalNumber(input: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  const value = input[key];
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    issues.push({ path: `${path}.${key}`, message: `${key} must be a finite number when provided.` });
  }
}

function validateOptionalBoolean(input: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (input[key] !== undefined && typeof input[key] !== "boolean") {
    issues.push({ path: `${path}.${key}`, message: `${key} must be a boolean when provided.` });
  }
}

function validateKnownStringArray(value: unknown, allowed: readonly string[], path: string, label: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path, message: `${path.split(".").pop() || "value"} must be an array.` });
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== "string" || !allowed.includes(item)) {
      issues.push({ path: `${path}[${index}]`, message: `${label} must be one of: ${allowed.join(", ")}.` });
    }
  });
}

function validateOptionalSource(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined) {
    issues.push(...validateSource(value, path));
  }
}

function validateSourceReferences(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path, message: "references must be an array." });
    return;
  }
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push({ path: `${path}[${index}]`, message: "references entries must be objects." });
      return;
    }
    requireStringAt(item, "label", `${path}[${index}]`, issues);
    validateOptionalString(item, "uri", `${path}[${index}]`, issues);
    if (item.kind !== undefined && !["log", "artifact", "command", "url", "note"].includes(String(item.kind))) {
      issues.push({ path: `${path}[${index}].kind`, message: "reference kind must be log, artifact, command, url, or note." });
    }
  });
}

function validateMetadata(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path, message: "metadata must be a JSON object when provided." });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!isJsonValue(item)) {
      issues.push({ path: `${path}.${key}`, message: "metadata values must be JSON-compatible." });
    }
  }
}

function validateHeadPose(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path, message: "head_pose must be an object when provided." });
    return;
  }
  for (const axis of ["pitch", "yaw", "roll"] as const) {
    if (value[axis] !== undefined && (typeof value[axis] !== "number" || !Number.isFinite(value[axis]))) {
      issues.push({ path: `${path}.${axis}`, message: `${axis} must be a finite number when provided.` });
    }
  }
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 8) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (isRecord(value)) return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  return false;
}

function isScalar(value: unknown): value is string | number | boolean | null | undefined {
  return ["string", "number", "boolean", "undefined"].includes(typeof value) || value === null;
}

function validateTranscript(value: unknown, issues: ValidationIssue[]): void {
  if (value === undefined || !Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push({ path: `$.transcript[${index}]`, message: "transcript entries must be objects." });
      return;
    }
    if (!isString(item.speaker)) {
      issues.push({ path: `$.transcript[${index}].speaker`, message: "speaker is required and must be a string." });
    }
    if (!isString(item.text)) {
      issues.push({ path: `$.transcript[${index}].text`, message: "text is required and must be a string." });
    }
  });
}

function validatePeople(value: unknown, issues: ValidationIssue[]): void {
  if (value === undefined || !Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push({ path: `$.people[${index}]`, message: "people entries must be objects." });
      return;
    }
    if (!isString(item.name)) {
      issues.push({ path: `$.people[${index}].name`, message: "name is required and must be a string." });
    }
    for (const key of ["role", "company", "reason", "image"] as const) {
      if (item[key] !== undefined && typeof item[key] !== "string") {
        issues.push({ path: `$.people[${index}].${key}`, message: `${key} must be a string when provided.` });
      }
    }
    if (item.score !== undefined && !isScalar(item.score)) {
      issues.push({ path: `$.people[${index}].score`, message: "score must be a scalar when provided." });
    }
  });
}

function validateChoices(value: unknown, issues: ValidationIssue[], path = "$.choices"): void {
  if (value === undefined || !Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push({ path: `${path}[${index}]`, message: "choices entries must be objects." });
      return;
    }
    if (!isString(item.label)) {
      issues.push({ path: `${path}[${index}].label`, message: "label is required and must be a string." });
    }
    if (item.id !== undefined && typeof item.id !== "string") {
      issues.push({ path: `${path}[${index}].id`, message: "id must be a string when provided." });
    }
    if (item.tone !== undefined && !["primary", "secondary", "danger"].includes(String(item.tone))) {
      issues.push({ path: `${path}[${index}].tone`, message: "tone must be primary, secondary, or danger." });
    }
  });
}

function validateTable(columns: unknown, rows: unknown, issues: ValidationIssue[]): void {
  if (columns !== undefined && !arrayOfStrings(columns)) {
    issues.push({ path: "$.columns", message: "columns must be an array of strings." });
  }
  if (rows === undefined || !Array.isArray(rows)) return;
  rows.forEach((row, index) => {
    if (Array.isArray(row)) {
      row.forEach((cell, cellIndex) => {
        if (!isScalar(cell)) {
          issues.push({ path: `$.rows[${index}][${cellIndex}]`, message: "table cells must be scalar values." });
        }
      });
      return;
    }
    if (!isRecord(row)) {
      issues.push({ path: `$.rows[${index}]`, message: "table rows must be arrays or objects." });
      return;
    }
    for (const [key, cell] of Object.entries(row)) {
      if (!isScalar(cell)) {
        issues.push({ path: `$.rows[${index}].${key}`, message: "table cells must be scalar values." });
      }
    }
  });
}

function validateChecklistItems(value: unknown, issues: ValidationIssue[]): void {
  if (value === undefined || !Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push({ path: `$.items[${index}]`, message: "checklist items must be objects." });
      return;
    }
    if (!isString(item.label)) {
      issues.push({ path: `$.items[${index}].label`, message: "label is required and must be a string." });
    }
    if (item.checked !== undefined && typeof item.checked !== "boolean") {
      issues.push({ path: `$.items[${index}].checked`, message: "checked must be a boolean when provided." });
    }
    if (item.status !== undefined && typeof item.status !== "string") {
      issues.push({ path: `$.items[${index}].status`, message: "status must be a string when provided." });
    }
  });
}

function normalizeRows(rows: TableRow[] | undefined): TableRow[] | undefined {
  if (!Array.isArray(rows)) return undefined;
  return rows.map((row) => {
    if (Array.isArray(row)) return row.map((item) => cleanText(item, 36)).slice(0, 4);
    if (isRecord(row)) {
      const clean: Record<string, string> = {};
      for (const [key, value] of Object.entries(row).slice(0, 4)) {
        clean[cleanText(key, 24)] = cleanText(value, 36);
      }
      return clean;
    }
    return [cleanText(row, 36)];
  });
}

function normalizeChecklistItems(items: ChecklistItem[] | undefined, bullets: string[] | undefined): ChecklistItem[] | undefined {
  if (Array.isArray(items)) {
    return items.map((item) => ({
      label: cleanText(item.label, 80),
      checked: Boolean(item.checked),
      status: optionalText(item.status, 24),
    }));
  }
  if (Array.isArray(bullets)) {
    return bullets.map((label) => ({ label: cleanText(label, 80), checked: false }));
  }
  return undefined;
}
