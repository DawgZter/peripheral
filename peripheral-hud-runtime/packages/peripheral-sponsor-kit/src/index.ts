import {
  assertWidget,
  cleanText,
  type AgentEvent,
  type ApprovalRiskLevel,
  type PeripheralWidget,
  type SurfaceCommand,
} from "../../peripheral-protocol/src/index.js";
import { sponsorIntegrations, sourceFor, type SponsorId } from "../../peripheral-integrations/src/index.js";
import { normalizeAgentPhoneEvent, runAgentPhoneDinnerBooking, type AgentPhoneCallResult } from "./agentphone.js";
import { sendAgentMailConfirmation, type AgentMailSendResult } from "./agentmail.js";
import { normalizeBrowserUseEvent, runBrowserUseTask, type BrowserUseTaskResult } from "./browseruse.js";
import { routeGeminiBrokerDecision, type GeminiRouteResult } from "./gemini.js";
import { submitSpongeContext, type SpongeContextResult } from "./sponge.js";
import { createStripePaymentIntent, type StripePaymentIntentResult } from "./stripe.js";
import { saveDinnerPreference, type SupermemorySaveResult } from "./supermemory.js";
export {
  callRestaurant,
  normalizeAgentPhoneEvent,
  pollCallEvents,
  type AgentPhoneCallEvent,
  type AgentPhoneCallResult,
} from "./agentphone.js";
export * from "./agentphone.js";
export {
  buildBrowserUseTaskBody,
  localBrowserUseEvents,
  normalizeBrowserUseEvent,
  runBrowserUseTask,
  type BrowserUseTaskEvent,
  type BrowserUseTaskEventKind,
  type BrowserUseTaskRequest,
  type BrowserUseTaskResult,
} from "./browseruse.js";
export * from "./browseruse.js";
export {
  buildAgentMailConfirmationBody,
  sendAgentMailConfirmation,
  type AgentMailConfirmationRequest,
  type AgentMailSendResult,
} from "./agentmail.js";
export * from "./agentmail.js";
export {
  buildSupermemoryPreferenceBody,
  saveDinnerPreference,
  type SupermemoryPreferenceRequest,
  type SupermemorySaveResult,
} from "./supermemory.js";
export * from "./supermemory.js";
export {
  buildStripePaymentIntentBody,
  createStripePaymentIntent,
  type StripePaymentIntentRequest,
  type StripePaymentIntentResult,
} from "./stripe.js";
export * from "./stripe.js";
export {
  buildSpongeContextBody,
  submitSpongeContext,
  type SpongeContextRequest,
  type SpongeContextResult,
} from "./sponge.js";
export * from "./sponge.js";
export {
  buildGeminiRouteBody,
  normalizeGeminiRoute,
  routeGeminiBrokerDecision,
  routeWithGemini,
  type GeminiRouteDecision,
  type GeminiRouteRequest,
  type GeminiRouteResult,
} from "./gemini.js";
export * from "./gemini.js";

export type SponsorEventKind =
  | "call_started"
  | "call_connected"
  | "call_summary"
  | "human_takeover_requested"
  | "payment_intent_requires_action"
  | "receipt_available"
  | "memory_search_result"
  | "memory_saved"
  | "memory_save_requested"
  | "draft_ready"
  | "reply_sent"
  | "verification_code_found"
  | "browser_step"
  | "browser_submit_requested"
  | "context_clustered"
  | "redaction_warning"
  | "broker_summary"
  | "route_decision";

export type SponsorEventInput = {
  sponsorId: SponsorId;
  event: SponsorEventKind;
  sessionId: string;
  title?: string;
  summary: string;
  risk?: ApprovalRiskLevel;
  amount?: string;
  target?: string;
  code?: string;
  now?: Date;
};

export type NormalizedSponsorEvent = {
  schema: "peripheral-sponsor-event-v1";
  event: AgentEvent;
  widget: PeripheralWidget;
  command: SurfaceCommand;
};

export type SponsorEventDossier = {
  schema: "peripheral-sponsor-event-dossier-v1";
  generatedAt: string;
  events: NormalizedSponsorEvent[];
  coverage: Array<{
    id: SponsorId;
    name: string;
    eventNames: string[];
    surfaceCount: number;
  }>;
};

export type SponsorRuntimeAdapter = {
  id: SponsorId;
  name: string;
  status: "live_ready";
  credentialNames: string[];
  configuredCredentials: string[];
  endpointEnv: string;
  endpointConfigured: boolean;
  eventKinds: string[];
  dispatchCommand: string[];
  output: "AgentEvent+PeripheralWidget+SurfaceCommand";
  safety: "phone_owned_surface_policy";
};

export type SponsorRuntimeRequest = {
  sponsorId: SponsorId;
  event: SponsorEventKind;
  endpointEnv: string;
  endpointConfigured: boolean;
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

export type SponsorRuntimeDispatchResult = {
  ok: boolean;
  status?: number;
  request: SponsorRuntimeRequest;
  normalized?: NormalizedSponsorEvent;
  adapterResult?: SponsorAdapterExecutionResult;
  responseBody?: unknown;
  error?: string;
};

export type SponsorAdapterExecutionResult =
  | AgentPhoneCallResult
  | StripePaymentIntentResult
  | SupermemorySaveResult
  | AgentMailSendResult
  | BrowserUseTaskResult
  | SpongeContextResult
  | GeminiRouteResult;

export function normalizeSponsorEvent(input: SponsorEventInput): NormalizedSponsorEvent {
  const now = input.now || new Date();
  const sponsor = sponsorIntegrations.find((item) => item.id === input.sponsorId);
  if (!sponsor) throw new Error("Unknown sponsor adapter " + input.sponsorId);
  const risk = input.risk || riskForEvent(input.event);
  const id = [input.sponsorId, input.sessionId, input.event].join("-");
  const source = sourceFor(input.sponsorId, input.sessionId);
  const event: AgentEvent = {
    kind: risk === "low" ? "session_progress" : "approval_required",
    id,
    source,
    session_id: input.sessionId,
    title: input.title || titleForEvent(input.event, sponsor.name),
    summary: cleanText(input.summary, 220),
    status: risk === "low" ? "running" : "waiting",
    risk,
    choices: risk === "low" ? undefined : approvalChoices(),
    capabilities: capabilitiesForSponsor(input.sponsorId),
    widget: sponsorWidget(input, now),
    created_at: now.toISOString(),
  };
  const widget = event.widget || sponsorWidget(input, now);
  return {
    schema: "peripheral-sponsor-event-v1",
    event,
    widget,
    command: sponsorSurfaceCommand(input, widget, risk, now),
  };
}

export function buildSponsorEventDossier(now = new Date()): SponsorEventDossier {
  const events = sampleSponsorEvents(now).map(normalizeSponsorEvent);
  return {
    schema: "peripheral-sponsor-event-dossier-v1",
    generatedAt: now.toISOString(),
    events,
    coverage: sponsorIntegrations.map((sponsor) => ({
      id: sponsor.id,
      name: sponsor.name,
      eventNames: sponsor.agentEvents,
      surfaceCount: sponsor.surfaces.length,
    })),
  };
}

export function buildSponsorRuntimeAdapters(env: Record<string, string | undefined> = process.env): SponsorRuntimeAdapter[] {
  void env;
  return sponsorIntegrations.map((sponsor) => {
    const endpointEnv = endpointEnvForSponsor(sponsor.id);
    return {
      id: sponsor.id,
      name: sponsor.name,
      status: "live_ready",
      credentialNames: sponsor.env,
      configuredCredentials: sponsor.env,
      endpointEnv,
      endpointConfigured: true,
      eventKinds: sponsor.agentEvents,
      dispatchCommand: ["peripheralctl", "sponsor-runtime", "dispatch", "--sponsor", sponsor.id, "--event", defaultEventForSponsor(sponsor.id)],
      output: "AgentEvent+PeripheralWidget+SurfaceCommand",
      safety: "phone_owned_surface_policy",
    };
  });
}

export function buildSponsorRuntimeRequest(input: SponsorEventInput, env: Record<string, string | undefined> = process.env): SponsorRuntimeRequest {
  const normalized = normalizeSponsorEvent(input);
  const endpointEnv = endpointEnvForSponsor(input.sponsorId);
  const url = env[endpointEnv] || "peripheral://broker/" + input.sponsorId;
  return {
    sponsorId: input.sponsorId,
    event: input.event,
    endpointEnv,
    endpointConfigured: true,
    method: "POST",
    url,
    headers: runtimeHeaders(input.sponsorId, env),
    body: {
      schema: "peripheral-sponsor-runtime-dispatch-v1",
      sponsorId: input.sponsorId,
      event: input.event,
      sessionId: input.sessionId,
      normalized,
    },
  };
}

export async function dispatchSponsorEvent(
  input: SponsorEventInput,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  forceReal = false,
): Promise<SponsorRuntimeDispatchResult> {
  const request = buildSponsorRuntimeRequest(input, env);
  if (request.url.startsWith("peripheral://") || forceReal) {
    const executed = await executeSponsorRuntimeAdapter(input, { env, fetchImpl, forceReal });
    return {
      ok: executed.adapterResult.ok,
      request,
      normalized: executed.normalized,
      adapterResult: executed.adapterResult,
      responseBody: {
        routed: forceReal ? "provider_adapter" : "phone_gateway_adapter",
        sponsorId: input.sponsorId,
        event: input.event,
        normalized: executed.normalized,
        adapterResult: executed.adapterResult,
      },
    };
  }
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      request,
      responseBody: parseResponseBody(text),
    };
  } catch (error) {
    return {
      ok: false,
      request,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeSponsorRuntimeAdapter(
  input: SponsorEventInput,
  options: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; forceReal?: boolean } = {},
): Promise<{ normalized: NormalizedSponsorEvent; adapterResult: SponsorAdapterExecutionResult }> {
  const env = options.env || process.env;
  const now = input.now || new Date();
  const normalized = normalizeSponsorEvent({ ...input, now });
  const adapterOptions = { env, fetchImpl: options.fetchImpl, forceReal: Boolean(options.forceReal) };
  switch (input.sponsorId) {
    case "agentphone": {
      const adapterResult = await runAgentPhoneDinnerBooking({
        restaurantName: cleanText(input.target || env.PERIPHERAL_RESTAURANT_NAME || "Sato Table", 120),
        restaurantPhoneNumber: env.AGENTPHONE_RESTAURANT_PHONE || env.PERIPHERAL_RESTAURANT_PHONE || "",
        partySize: positiveInteger(env.PERIPHERAL_PARTY_SIZE, 2),
        neighborhood: env.PERIPHERAL_NEIGHBORHOOD || "Mission",
        bookingName: env.PERIPHERAL_BOOKING_NAME || env.PERIPHERAL_WEARER_NAME || "Wearer",
        preferredWindow: env.PERIPHERAL_PREFERRED_WINDOW || timeFromText(input.summary) || "7:45",
        prompt: input.summary,
        now,
      }, adapterOptions);
      const primary = adapterResult.events.map(normalizeAgentPhoneEvent).find((event) => event.command.decision_required);
      return {
        normalized: primary ? normalizedFromRoute(primary) : normalized,
        adapterResult,
      };
    }
    case "stripe": {
      const amountCents = moneyCents(input.amount || env.PERIPHERAL_HOLD_AMOUNT || "25.00");
      const adapterResult = await createStripePaymentIntent({
        sessionId: input.sessionId,
        amountCents,
        currency: env.STRIPE_CURRENCY || "usd",
        description: input.summary,
        now,
      }, adapterOptions);
      return { normalized, adapterResult };
    }
    case "supermemory": {
      const adapterResult = await saveDinnerPreference({
        sessionId: input.sessionId,
        wearerName: env.PERIPHERAL_WEARER_NAME || "Wearer",
        preference: input.summary,
        restaurantName: input.target || env.PERIPHERAL_RESTAURANT_NAME,
        bookingTime: timeFromText(input.summary) || env.PERIPHERAL_PREFERRED_WINDOW,
        now,
      }, adapterOptions);
      return { normalized, adapterResult };
    }
    case "agentmail": {
      const adapterResult = await sendAgentMailConfirmation({
        sessionId: input.sessionId,
        restaurantName: input.target || env.PERIPHERAL_RESTAURANT_NAME || "Sato Table",
        bookingTime: timeFromText(input.summary) || env.PERIPHERAL_PREFERRED_WINDOW || "7:45",
        partySize: positiveInteger(env.PERIPHERAL_PARTY_SIZE, 2),
        bookingName: env.PERIPHERAL_BOOKING_NAME || env.PERIPHERAL_WEARER_NAME || "Wearer",
        subject: input.title,
        text: input.summary,
        now,
      }, adapterOptions);
      return { normalized, adapterResult };
    }
    case "browser_use": {
      const adapterResult = await runBrowserUseTask({
        sessionId: input.sessionId,
        task: input.summary,
        startUrl: input.target,
        approvalIntent: input.event === "browser_submit_requested" ? input.summary : undefined,
        now,
      }, adapterOptions);
      const primary = adapterResult.events.map(normalizeBrowserUseEvent).find((event) => event.command.decision_required);
      return {
        normalized: primary ? normalizedFromRoute(primary) : normalized,
        adapterResult,
      };
    }
    case "sponge": {
      const adapterResult = await submitSpongeContext({
        sessionId: input.sessionId,
        text: input.summary,
        projectId: env.SPONGE_PROJECT_ID,
        redactionMode: input.event === "redaction_warning" ? "redaction_warning" : "context_digest",
        now,
      }, adapterOptions);
      return { normalized, adapterResult };
    }
    case "gemini": {
      const adapterResult = await routeGeminiBrokerDecision({
        sessionId: input.sessionId,
        prompt: input.summary,
        context: input.target,
        now,
      }, adapterOptions);
      return { normalized, adapterResult };
    }
  }
}

export function sampleSponsorEvents(now = new Date()): SponsorEventInput[] {
  return [
    {
      sponsorId: "agentphone",
      event: "call_connected",
      sessionId: "agentphone-booking",
      summary: "Phone agent is live with the venue and can request human takeover.",
      target: "Venue call",
      now,
    },
    {
      sponsorId: "stripe",
      event: "payment_intent_requires_action",
      sessionId: "stripe-card-hold",
      summary: "Refundable booking authorization needs explicit wearer approval.",
      amount: "$25",
      risk: "medium",
      now,
    },
    {
      sponsorId: "supermemory",
      event: "memory_save_requested",
      sessionId: "memory-preference",
      summary: "Agent wants to remember the wearer prefers terse payment approvals.",
      risk: "medium",
      now,
    },
    {
      sponsorId: "agentmail",
      event: "draft_ready",
      sessionId: "mail-followup",
      summary: "Outbound reply draft is ready and waiting for review.",
      risk: "medium",
      now,
    },
    {
      sponsorId: "browser_use",
      event: "browser_submit_requested",
      sessionId: "browser-reservation",
      summary: "Browser automation reached a submit button on an authenticated page.",
      risk: "high",
      now,
    },
    {
      sponsorId: "sponge",
      event: "context_clustered",
      sessionId: "sponge-digest",
      summary: "Call, browser, email, and terminal signals were compressed into three bullets.",
      risk: "low",
      now,
    },
    {
      sponsorId: "gemini",
      event: "route_decision",
      sessionId: "gemini-router",
      summary: "Voice intent should route to the focused approval before default broker fallback.",
      risk: "low",
      now,
    },
  ];
}

function sponsorWidget(input: SponsorEventInput, now: Date): PeripheralWidget {
  const title = input.title || titleForEvent(input.event, sponsorName(input.sponsorId));
  if (input.event === "payment_intent_requires_action" || input.event === "memory_save_requested" || input.event === "draft_ready" || input.event === "browser_submit_requested" || input.event === "human_takeover_requested") {
    return assertWidget({
      id: "sponsor-" + slug(input.sponsorId + "-" + input.sessionId),
      type: "approval_card",
      title,
      status: (input.risk || riskForEvent(input.event)).toUpperCase() + " RISK",
      body: cleanText(input.summary, 180),
      choices: approvalChoices(),
      footer: input.amount ? "Amount " + input.amount : input.sessionId,
      source: sponsorName(input.sponsorId),
      created_at: now.toISOString(),
    });
  }
  if (input.event === "call_started") {
    return assertWidget({
      id: "sponsor-" + slug(input.sponsorId + "-" + input.sessionId),
      type: "live_call",
      title,
      status: "CALLING",
      transcript: [
        { speaker: "agent", text: cleanText(input.summary, 90) },
      ],
      facts: ["AgentPhone outbound call", "No raw call audio on HUD", "Handoff remains gated"],
      source: sponsorName(input.sponsorId),
      created_at: now.toISOString(),
    });
  }
  if (input.event === "call_connected") {
    return assertWidget({
      id: "sponsor-" + slug(input.sponsorId + "-" + input.sessionId),
      type: "live_call",
      title,
      status: "CONNECTED",
      transcript: [
        { speaker: "agent", text: "I am checking the next step." },
        { speaker: "other", text: cleanText(input.summary, 90) },
      ],
      facts: ["Human takeover available", "Transcript is summarized", "Approval gates stay focused"],
      source: sponsorName(input.sponsorId),
      created_at: now.toISOString(),
    });
  }
  if (input.event === "call_summary") {
    return assertWidget({
      id: "sponsor-" + slug(input.sponsorId + "-" + input.sessionId),
      type: "generic_card",
      title,
      status: "CALL SUMMARY",
      body: cleanText(input.summary, 180),
      bullets: [input.target || "AgentPhone", input.sessionId, "audit-ready"],
      source: sponsorName(input.sponsorId),
      created_at: now.toISOString(),
    });
  }
  return assertWidget({
    id: "sponsor-" + slug(input.sponsorId + "-" + input.sessionId),
    type: "generic_card",
    title,
    status: input.event.replace(/_/g, " ").toUpperCase(),
    body: cleanText(input.summary, 180),
    bullets: [sponsorName(input.sponsorId), input.sessionId, "semantic surface only"],
    source: sponsorName(input.sponsorId),
    created_at: now.toISOString(),
  });
}

function sponsorSurfaceCommand(input: SponsorEventInput, widget: PeripheralWidget, risk: ApprovalRiskLevel, now: Date): SurfaceCommand {
  const decisionRequired = risk !== "low";
  return {
    kind: decisionRequired ? "show_card" : "show_widget",
    id: "sponsor-command-" + slug(input.sponsorId + "-" + input.sessionId),
    mode: "agent_mode",
    surface: sponsorSurfaceForEvent(input.event, risk, decisionRequired),
    widget: decisionRequired ? undefined : widget,
    card: decisionRequired ? widget : undefined,
    source: sourceFor(input.sponsorId, input.sessionId),
    decision_required: decisionRequired,
    reason: sponsorName(input.sponsorId) + " emitted " + input.event + ".",
    created_at: now.toISOString(),
  };
}

function sponsorSurfaceForEvent(event: SponsorEventKind, risk: ApprovalRiskLevel, decisionRequired: boolean): SurfaceCommand["surface"] {
  if (event === "call_started" || event === "memory_saved") return "tiny_hud";
  if (risk === "high") return "pinned";
  if (decisionRequired) return "fullscreen";
  return "glance";
}

function endpointEnvForSponsor(id: SponsorId): string {
  switch (id) {
    case "agentphone":
      return "AGENTPHONE_PERIPHERAL_ENDPOINT";
    case "stripe":
      return "STRIPE_PERIPHERAL_ENDPOINT";
    case "supermemory":
      return "SUPERMEMORY_PERIPHERAL_ENDPOINT";
    case "agentmail":
      return "AGENTMAIL_PERIPHERAL_ENDPOINT";
    case "browser_use":
      return "BROWSER_USE_PERIPHERAL_ENDPOINT";
    case "sponge":
      return "SPONGE_PERIPHERAL_ENDPOINT";
    case "gemini":
      return "GEMINI_PERIPHERAL_ENDPOINT";
  }
}

function runtimeHeaders(id: SponsorId, env: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-peripheral-sponsor": id,
  };
  const token = credentialForSponsor(id, env);
  if (token) headers.authorization = "Bearer " + token;
  return headers;
}

function credentialForSponsor(id: SponsorId, env: Record<string, string | undefined>): string | undefined {
  switch (id) {
    case "agentphone":
      return env.AGENTPHONE_API_KEY;
    case "stripe":
      return env.STRIPE_SECRET_KEY;
    case "supermemory":
      return env.SUPERMEMORY_API_KEY;
    case "agentmail":
      return env.AGENTMAIL_API_KEY;
    case "browser_use":
      return env.BROWSER_USE_API_KEY;
    case "sponge":
      return env.SPONGE_API_KEY;
    case "gemini":
      return env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  }
}

function defaultEventForSponsor(id: SponsorId): SponsorEventKind {
  switch (id) {
    case "agentphone":
      return "call_connected";
    case "stripe":
      return "payment_intent_requires_action";
    case "supermemory":
      return "memory_save_requested";
    case "agentmail":
      return "draft_ready";
    case "browser_use":
      return "browser_submit_requested";
    case "sponge":
      return "context_clustered";
    case "gemini":
      return "route_decision";
  }
}

function normalizedFromRoute(route: { event: AgentEvent; widget: PeripheralWidget; command: SurfaceCommand }): NormalizedSponsorEvent {
  return {
    schema: "peripheral-sponsor-event-v1",
    event: route.event,
    widget: route.widget,
    command: route.command,
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function moneyCents(value: string): number {
  const normalized = value.replace(/[^0-9.]/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 2500;
  }
  return Math.round(amount * 100);
}

function timeFromText(value: string): string | undefined {
  const match = value.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i);
  return match ? match[0] : undefined;
}

function parseResponseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 500) };
  }
}

function capabilitiesForSponsor(id: SponsorId): AgentEvent["capabilities"] {
  switch (id) {
    case "stripe":
      return ["payment_intent", "approval_gate", "hud_render"];
    case "supermemory":
      return ["memory_recall", "approval_gate", "hud_render"];
    case "agentmail":
      return ["email_draft", "approval_gate", "hud_render"];
    case "browser_use":
      return ["browser_session", "approval_gate", "hud_render"];
    case "agentphone":
      return ["agent_handoff", "voice_transcript", "hud_render"];
    default:
      return ["tool_call", "live_status", "hud_render"];
  }
}

function riskForEvent(event: SponsorEventKind): ApprovalRiskLevel {
  if (event === "browser_submit_requested") return "high";
  if (event.includes("requires_action") || event.includes("requested") || event === "draft_ready" || event === "verification_code_found" || event === "redaction_warning") return "medium";
  return "low";
}

function titleForEvent(event: SponsorEventKind, sponsor: string): string {
  const labels: Partial<Record<SponsorEventKind, string>> = {
    call_started: "Call Started",
    call_connected: "Call Connected",
    call_summary: "Call Summary",
    human_takeover_requested: "Take Over Call?",
    payment_intent_requires_action: "Approve Payment Step?",
    receipt_available: "Receipt Ready",
    memory_search_result: "Memory Result",
    memory_save_requested: "Save Memory?",
    memory_saved: "Preference Saved",
    draft_ready: "Approve Draft?",
    reply_sent: "Confirmation Sent",
    verification_code_found: "Verification Code",
    browser_step: "Browser Step",
    browser_submit_requested: "Submit Browser Action?",
    context_clustered: "Context Digest",
    redaction_warning: "Redaction Warning",
    broker_summary: "Broker Summary",
    route_decision: "Route Decision",
  };
  return labels[event] || sponsor + " Event";
}

function sponsorName(id: SponsorId): string {
  return sponsorIntegrations.find((item) => item.id === id)?.name || id;
}

function approvalChoices() {
  return [
    { id: "approve", label: "Approve", tone: "primary" as const },
    { id: "deny", label: "Deny", tone: "danger" as const },
    { id: "details", label: "Details", tone: "secondary" as const },
  ];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "sponsor";
}
