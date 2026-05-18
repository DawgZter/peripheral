import {
  type AppMode,
  type ApprovalRiskLevel,
  type ConfirmationLevel,
  type InputEvent,
  type PeripheralSource,
  type PeripheralWidget,
  type SurfaceCommand,
  type SurfaceKind,
  type SurfaceLease,
  type SurfacePriority,
  type UserDecision,
} from "../../peripheral-protocol/src/index.js";

export type PhoneSurfaceRuntimeState = {
  schema: "peripheral-phone-surface-runtime-v1";
  mode: AppMode;
  activeLease: SurfaceLease;
  focusedCardId: string | null;
  focusedWidgetId: string | null;
  queue: SurfaceCommand[];
  history: Array<{
    at: string;
    event: string;
    detail: string;
  }>;
};

export type LeaseDecision = {
  accepted: boolean;
  reason: string;
  previousLeaseId: string;
  nextLeaseId: string;
  state: PhoneSurfaceRuntimeState;
};

export type InputRouteDecision = {
  target: "focused_card" | "focused_widget" | "named_agent" | "mode_manager" | "broker";
  reason: string;
  agentName?: string;
  event: InputEvent;
};

export type PhoneRuntimeSnapshot = {
  schema: "peripheral-phone-runtime-snapshot-v1";
  generatedAt: string;
  thesis: string;
  modes: AppMode[];
  priorityOrder: SurfacePriority[];
  routingOrder: string[];
  approvalPolicy: PhoneApprovalPolicy;
  state: PhoneSurfaceRuntimeState;
};

export type PhoneApprovalPolicyRule = {
  risk: ApprovalRiskLevel;
  requiredConfirmation: ConfirmationLevel[];
  wearerAction: string;
  rationale: string;
};

export type PhoneApprovalPolicy = {
  schema: "peripheral-phone-approval-policy-v1";
  generatedAt: string;
  rules: PhoneApprovalPolicyRule[];
  defaultRisk: ApprovalRiskLevel;
  nonApproveChoices: string;
};

export type ApprovalPolicyEvaluation = {
  schema: "peripheral-approval-policy-evaluation-v1";
  eventId: string;
  sessionId: string;
  risk: ApprovalRiskLevel;
  decision: UserDecision["decision"];
  providedConfirmation: ConfirmationLevel;
  requiredConfirmation: ConfirmationLevel[];
  accepted: boolean;
  reason: string;
  nextAction: "continue_action" | "block_action" | "show_details" | "record_denial" | "dismiss_card";
  evaluatedAt: string;
};

const priorityRank: Record<SurfacePriority, number> = {
  ambient: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

const defaultSource: PeripheralSource = {
  id: "phone-runtime",
  label: "Phone Surface Runtime",
  kind: "system",
  vendor: "Peripheral",
  trust: "local",
};

export function createPhoneSurfaceRuntime(now = new Date()): PhoneSurfaceRuntimeState {
  return {
    schema: "peripheral-phone-surface-runtime-v1",
    mode: "current_stage",
    activeLease: currentStageLease(now),
    focusedCardId: null,
    focusedWidgetId: null,
    queue: [],
    history: [
      {
        at: now.toISOString(),
        event: "runtime.created",
        detail: "Phone owns BLE, renderer, input capture, and final display decisions.",
      },
    ],
  };
}

export function requestSurfaceLease(
  state: PhoneSurfaceRuntimeState,
  requested: SurfaceLease,
  now = new Date(),
): LeaseDecision {
  const normalized: SurfaceLease = {
    ...requested,
    created_at: requested.created_at || now.toISOString(),
  };
  const accepted = canAcquireLease(state.activeLease, normalized);
  const nextState = accepted
    ? {
        ...state,
        mode: normalized.mode,
        activeLease: normalized,
        history: appendHistory(state, now, "lease.accepted", normalized.id + " took " + normalized.surface),
      }
    : {
        ...state,
        queue: enqueueCommand(state.queue, leaseDeniedCommand(normalized, now)),
        history: appendHistory(state, now, "lease.denied", normalized.id + " queued behind " + state.activeLease.id),
      };
  return {
    accepted,
    reason: accepted ? "Lease accepted by priority/mode policy." : "Active lease is not interruptible or has higher priority.",
    previousLeaseId: state.activeLease.id,
    nextLeaseId: accepted ? normalized.id : state.activeLease.id,
    state: nextState,
  };
}

export function applySurfaceCommand(
  state: PhoneSurfaceRuntimeState,
  command: SurfaceCommand,
  now = new Date(),
): LeaseDecision {
  const lease = command.lease || leaseForCommand(command, state.activeLease, now);
  const decision = requestSurfaceLease(state, lease, now);
  if (!decision.accepted) return decision;
  const widget = command.card || command.widget;
  return {
    ...decision,
    state: {
      ...decision.state,
      mode: modeForCommand(command, decision.state.mode),
      focusedCardId: command.card ? widget?.id || command.id : decision.state.focusedCardId,
      focusedWidgetId: command.widget ? widget?.id || command.id : decision.state.focusedWidgetId,
      queue: drainQueue(decision.state.queue, command.surface),
      history: appendHistory(decision.state, now, "surface.command", command.kind + " on " + command.surface),
    },
  };
}

export function routeInputEvent(state: PhoneSurfaceRuntimeState, event: InputEvent): InputRouteDecision {
  const text = (event.text || "").trim();
  const named = namedAgent(text);
  if (state.focusedCardId || event.focused_card_id) {
    return {
      target: "focused_card",
      reason: "Focused card wins for approvals, details, replies, and dismissals.",
      event,
    };
  }
  if (state.focusedWidgetId || event.focused_widget_id) {
    return {
      target: "focused_widget",
      reason: "Focused widget owns local gestures before broker fallback.",
      event,
    };
  }
  if (named) {
    return {
      target: "named_agent",
      agentName: named,
      reason: "Explicit agent name in voice text wins after focused surfaces.",
      event,
    };
  }
  if (event.kind === "look_up" || text === "agent mode" || text === "show agents") {
    return {
      target: "mode_manager",
      reason: "Mode intent routes to the phone app mode manager.",
      event,
    };
  }
  return {
    target: "broker",
    reason: "No focused surface or named agent, so the default broker brain receives the input.",
    event,
  };
}

export function buildPhoneRuntimeSnapshot(now = new Date()): PhoneRuntimeSnapshot {
  return {
    schema: "peripheral-phone-runtime-snapshot-v1",
    generatedAt: now.toISOString(),
    thesis: "The phone app is the paired surface runtime: it owns display leases, rendering, input routing, and BLE writes; agents only request semantic UI.",
    modes: ["current_stage", "ambient_agent_hud", "agent_mode", "pairing", "debug", "system"],
    priorityOrder: ["ambient", "normal", "high", "urgent"],
    routingOrder: ["focused_card", "focused_widget", "named_agent", "mode_manager", "broker"],
    approvalPolicy: buildPhoneApprovalPolicy(now),
    state: createPhoneSurfaceRuntime(now),
  };
}

export function buildPhoneApprovalPolicy(now = new Date()): PhoneApprovalPolicy {
  return {
    schema: "peripheral-phone-approval-policy-v1",
    generatedAt: now.toISOString(),
    defaultRisk: "low",
    nonApproveChoices: "deny, details, and dismiss never advance the external action and may be captured from any focused card confirmation.",
    rules: [
      {
        risk: "low",
        requiredConfirmation: ["voice", "tap", "voice_and_tap", "phone", "desktop"],
        wearerAction: "Voice or tap is enough for reversible local checks and status changes.",
        rationale: "Low-risk actions should stay fast while still preserving an audit trail.",
      },
      {
        risk: "medium",
        requiredConfirmation: ["voice_and_tap", "phone", "desktop"],
        wearerAction: "Require voice plus tap, or a phone/desktop confirmation.",
        rationale: "Medium-risk sends, stores, and handoffs need a second signal from the wearer.",
      },
      {
        risk: "high",
        requiredConfirmation: ["phone", "desktop"],
        wearerAction: "Escalate to the phone or desktop before continuing.",
        rationale: "Payments, authenticated submissions, and irreversible actions should not advance from glasses-only voice.",
      },
    ],
  };
}

export function requiredConfirmationForRisk(risk: ApprovalRiskLevel): ConfirmationLevel[] {
  const policy = buildPhoneApprovalPolicy(new Date(0));
  return policy.rules.find((rule) => rule.risk === risk)?.requiredConfirmation || policy.rules[0]!.requiredConfirmation;
}

export function evaluateApprovalDecision(
  decision: UserDecision,
  risk: ApprovalRiskLevel = "low",
  now = new Date(),
): ApprovalPolicyEvaluation {
  const requiredConfirmation = requiredConfirmationForRisk(risk);
  if (decision.decision === "deny") {
    return approvalEvaluation(decision, risk, requiredConfirmation, true, "Denial recorded; external action remains blocked.", "record_denial", now);
  }
  if (decision.decision === "details") {
    return approvalEvaluation(decision, risk, requiredConfirmation, true, "Details requested; external action remains blocked.", "show_details", now);
  }
  if (decision.decision === "dismiss") {
    return approvalEvaluation(decision, risk, requiredConfirmation, true, "Approval card dismissed; external action remains blocked.", "dismiss_card", now);
  }
  const accepted = requiredConfirmation.includes(decision.confirmation_level);
  return approvalEvaluation(
    decision,
    risk,
    requiredConfirmation,
    accepted,
    accepted
      ? "Confirmation satisfies " + risk + "-risk approval policy."
      : "Confirmation must escalate to " + requiredConfirmation.join(" or ") + " before continuing.",
    accepted ? "continue_action" : "block_action",
    now,
  );
}

export function agentModeLease(reason: string, now = new Date()): SurfaceLease {
  return {
    id: "lease-agent-mode-" + stampId(now),
    owner: "broker",
    priority: "high",
    surface: "fullscreen",
    mode: "agent_mode",
    interruptible: true,
    reason,
    source: {
      ...defaultSource,
      id: "glass-broker",
      label: "Glass Broker",
    },
    requested_capabilities: ["hud_render", "approval_gate", "voice_transcript"],
    created_at: now.toISOString(),
  };
}

export function approvalSurfaceCommand(widget: PeripheralWidget, sessionId: string, now = new Date()): SurfaceCommand {
  const lease = agentModeLease("Focused approval card requested by agent session " + sessionId + ".", now);
  return {
    kind: "show_card",
    id: "command-approval-" + sanitizeId(sessionId),
    mode: "agent_mode",
    surface: "fullscreen",
    lease: {
      ...lease,
      agent_session_id: sessionId,
      requested_capabilities: ["approval_gate", "hud_render"],
    },
    card: widget,
    source: lease.source,
    decision_required: true,
    reason: "Approval cards require focused routing and explicit confirmation.",
    created_at: now.toISOString(),
  };
}

function approvalEvaluation(
  decision: UserDecision,
  risk: ApprovalRiskLevel,
  requiredConfirmation: ConfirmationLevel[],
  accepted: boolean,
  reason: string,
  nextAction: ApprovalPolicyEvaluation["nextAction"],
  now: Date,
): ApprovalPolicyEvaluation {
  return {
    schema: "peripheral-approval-policy-evaluation-v1",
    eventId: decision.event_id,
    sessionId: decision.session_id,
    risk,
    decision: decision.decision,
    providedConfirmation: decision.confirmation_level,
    requiredConfirmation,
    accepted,
    reason,
    nextAction,
    evaluatedAt: now.toISOString(),
  };
}

export function canAcquireLease(active: SurfaceLease, requested: SurfaceLease): boolean {
  if (active.owner === "system" && requested.owner !== "system") return false;
  if (active.mode === "debug" && requested.owner === "agent") return false;
  if (!active.interruptible && active.id !== requested.id) return false;
  if (requested.priority === "urgent") return true;
  return priorityRank[requested.priority] >= priorityRank[active.priority];
}

function currentStageLease(now: Date): SurfaceLease {
  return {
    id: "lease-current-stage",
    owner: "current_stage",
    priority: "normal",
    surface: "glance",
    mode: "current_stage",
    interruptible: true,
    reason: "Normal glasses/app experience owns the surface until Agent Mode is requested.",
    source: defaultSource,
    created_at: now.toISOString(),
  };
}

function leaseForCommand(command: SurfaceCommand, active: SurfaceLease, now: Date): SurfaceLease {
  return {
    id: command.lease_id || "lease-" + sanitizeId(command.id),
    owner: command.mode === "agent_mode" ? "broker" : active.owner,
    priority: command.decision_required ? "high" : "normal",
    surface: command.surface,
    mode: command.mode,
    interruptible: true,
    reason: command.reason || "Implicit lease for " + command.kind + ".",
    source: command.source || defaultSource,
    ttl_ms: command.ttl_ms,
    created_at: command.created_at || now.toISOString(),
  };
}

function leaseDeniedCommand(lease: SurfaceLease, now: Date): SurfaceCommand {
  return {
    kind: "show_status_icon",
    id: "queued-" + sanitizeId(lease.id),
    mode: lease.mode,
    surface: "tiny_hud",
    lease,
    source: lease.source,
    reason: "Queued because another surface lease is active.",
    created_at: now.toISOString(),
  };
}

function modeForCommand(command: SurfaceCommand, fallback: AppMode): AppMode {
  if (command.kind === "enter_agent_mode") return "agent_mode";
  if (command.kind === "exit_agent_mode") return "current_stage";
  return command.mode || fallback;
}

function appendHistory(
  state: PhoneSurfaceRuntimeState,
  now: Date,
  event: string,
  detail: string,
): PhoneSurfaceRuntimeState["history"] {
  return [
    ...state.history.slice(-24),
    {
      at: now.toISOString(),
      event,
      detail,
    },
  ];
}

function enqueueCommand(queue: SurfaceCommand[], command: SurfaceCommand): SurfaceCommand[] {
  return [...queue, command].slice(-20);
}

function drainQueue(queue: SurfaceCommand[], surface: SurfaceKind): SurfaceCommand[] {
  return queue.filter((item) => item.surface !== surface && item.lease?.surface !== surface);
}

function namedAgent(text: string): string | undefined {
  const match = /^(?:hey\s+)?(codex|claude|gemini|opencode|openclaw|pi|hermes)\b/i.exec(text);
  if (!match) return undefined;
  const normalized = match[1].toLowerCase();
  if (normalized === "opencode") return "OpenCode";
  if (normalized === "openclaw") return "OpenClaw";
  if (normalized === "pi") return "Pi";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "surface";
}

function stampId(now: Date): string {
  return now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}
