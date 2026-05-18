import {
  assertWidget,
  cleanText,
  type AgentEvent,
  type PeripheralWidget,
  type SurfaceCommand,
  type SurfaceKind,
} from "../../peripheral-protocol/src/index.js";
import { sourceFor } from "../../peripheral-integrations/src/index.js";

export type AgentPhoneDinnerRequest = {
  restaurantName: string;
  restaurantPhoneNumber: string;
  partySize: number;
  neighborhood: string;
  bookingName: string;
  preferredWindow: string;
  prompt: string;
  now?: Date;
};

export type AgentPhoneCallEventKind =
  | "call_started"
  | "call_connected"
  | "transcript"
  | "approval_required"
  | "call_completed"
  | "call_error";

export type AgentPhoneCallEvent = {
  id: string;
  kind: AgentPhoneCallEventKind;
  sessionId: string;
  callId?: string;
  restaurantName: string;
  restaurantPhoneNumber?: string;
  partySize?: number;
  bookingName?: string;
  selectedTime?: string;
  offeredTimes?: string[];
  text: string;
  status?: string;
  real: boolean;
  raw?: unknown;
  createdAt: string;
};

export type AgentPhoneCallHandle = {
  mode: "real" | "phone_gateway";
  ok: boolean;
  callId: string;
  endpoint: string | null;
  requestBody: Record<string, unknown> | null;
  reviewReason?: string;
  responseBody?: unknown;
  events?: AgentPhoneCallEvent[];
};

export type AgentPhoneCallResult = AgentPhoneCallHandle & {
  events: AgentPhoneCallEvent[];
};

export type AgentPhoneDinnerOptions = {
  forceReal?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  maxPolls?: number;
  now?: Date;
};

export type NormalizedAgentPhoneEvent = {
  schema: "peripheral-agentphone-event-v1";
  event: AgentEvent;
  widget: PeripheralWidget;
  command: SurfaceCommand;
  raw: AgentPhoneCallEvent;
};

export async function runAgentPhoneDinnerBooking(
  request: AgentPhoneDinnerRequest,
  options: AgentPhoneDinnerOptions = {},
): Promise<AgentPhoneCallResult> {
  const call = await callRestaurant(request, options);
  const events = await pollCallEvents(call, request, options);
  return { ...call, events };
}

export async function callRestaurant(
  request: AgentPhoneDinnerRequest,
  options: AgentPhoneDinnerOptions = {},
): Promise<AgentPhoneCallHandle> {
  const env = options.env || process.env;
  const now = options.now || request.now || new Date();
  const endpoint = agentPhoneCallsEndpoint(env);
  const requestBody = buildAgentPhoneCallBody(request, env, now);
  if (!options.forceReal) {
    return localCallHandle("phone gateway broker route", requestBody);
  }
  const apiKey = env.AGENTPHONE_API_KEY;
  if (!apiKey) {
    return localCallHandle("AgentPhone credential is externalized through the phone gateway", requestBody);
  }
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: "POST",
      headers: {
        "authorization": "Bearer " + apiKey,
        "content-type": "application/json",
        "x-peripheral-demo": "dinner-booking",
      },
      body: JSON.stringify(requestBody),
    });
    const body = await readJsonBody(response);
    const callId = stringField(body, ["id", "call_id", "callId", "session_id", "sessionId"]) || "agentphone-" + now.getTime();
    return {
      mode: "real",
      ok: response.ok,
      callId,
      endpoint,
      requestBody,
      responseBody: body,
      events: eventsFromAgentPhoneBody(body, request, callId, now),
      reviewReason: response.ok ? undefined : "AgentPhone returned HTTP " + response.status,
    };
  } catch (error) {
    return localCallHandle(error instanceof Error ? error.message : String(error), requestBody);
  }
}

export async function pollCallEvents(
  call: AgentPhoneCallHandle,
  request: AgentPhoneDinnerRequest,
  options: AgentPhoneDinnerOptions = {},
): Promise<AgentPhoneCallEvent[]> {
  const now = options.now || request.now || new Date();
  if (call.mode !== "real") {
    return localAgentPhoneEvents(request, call.callId, now);
  }
  if (call.events?.length) {
    return ensureApprovalEvent(call.events, request, call.callId, now);
  }
  const env = options.env || process.env;
  const apiKey = env.AGENTPHONE_API_KEY;
  if (!apiKey || !call.endpoint) {
    return ensureApprovalEvent([], request, call.callId, now);
  }
  const base = call.endpoint.replace(/\/calls\/?$/, "");
  const eventsUrl = base + "/calls/" + encodeURIComponent(call.callId) + "/events";
  const maxPolls = Math.max(1, Math.min(10, options.maxPolls || 2));
  const collected: AgentPhoneCallEvent[] = [];
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    try {
      const response = await (options.fetchImpl || fetch)(eventsUrl, {
        headers: {
          "authorization": "Bearer " + apiKey,
          "accept": "application/json",
          "x-peripheral-demo": "dinner-booking",
        },
      });
      const body = await readJsonBody(response);
      collected.push(...eventsFromAgentPhoneBody(body, request, call.callId, now));
      if (collected.some((event) => event.kind === "approval_required")) break;
    } catch {
      break;
    }
  }
  return ensureApprovalEvent(collected, request, call.callId, now);
}

export function localAgentPhoneEvents(
  request: AgentPhoneDinnerRequest,
  callId = "local-dinner-booking",
  now = request.now || new Date(),
): AgentPhoneCallEvent[] {
  const timestamp = now.toISOString();
  return [
    {
      id: "agentphone_call_started",
      kind: "call_started",
      sessionId: "dinner-booking",
      callId,
      restaurantName: request.restaurantName,
      restaurantPhoneNumber: request.restaurantPhoneNumber,
      partySize: request.partySize,
      bookingName: request.bookingName,
      selectedTime: request.preferredWindow,
      text: "Calling " + request.restaurantName + "...",
      status: "CALLING",
      real: false,
      createdAt: timestamp,
    },
    {
      id: "agentphone_transcript",
      kind: "transcript",
      sessionId: "dinner-booking",
      callId,
      restaurantName: request.restaurantName,
      restaurantPhoneNumber: request.restaurantPhoneNumber,
      partySize: request.partySize,
      bookingName: request.bookingName,
      selectedTime: request.preferredWindow,
      offeredTimes: [request.preferredWindow, "8:15"],
      text: "Restaurant: We have " + request.preferredWindow + " or 8:15.",
      status: "CONNECTED",
      real: false,
      createdAt: timestamp,
    },
    {
      id: "booking-approval-1",
      kind: "approval_required",
      sessionId: "dinner-booking",
      callId,
      restaurantName: request.restaurantName,
      restaurantPhoneNumber: request.restaurantPhoneNumber,
      partySize: request.partySize,
      bookingName: request.bookingName,
      selectedTime: request.preferredWindow,
      offeredTimes: [request.preferredWindow, "8:15"],
      text: "Approve booking " + request.preferredWindow + " for " + request.partySize + "?",
      status: "WAITING_FOR_APPROVAL",
      real: false,
      createdAt: timestamp,
    },
  ];
}

export function normalizeAgentPhoneEvent(event: AgentPhoneCallEvent): NormalizedAgentPhoneEvent {
  const source = sourceFor("agentphone", event.sessionId);
  const risk = event.kind === "approval_required" ? "medium" : "low";
  const widget = widgetForAgentPhoneEvent(event);
  const agentEvent: AgentEvent = {
    kind: event.kind === "approval_required" ? "approval_required" : event.kind === "call_completed" ? "session_completed" : "session_progress",
    id: event.id,
    source,
    session_id: event.sessionId,
    title: titleForAgentPhoneEvent(event),
    summary: cleanText(event.text, 220),
    status: event.kind === "approval_required" ? "waiting" : event.kind === "call_error" ? "error" : "running",
    risk,
    choices: event.kind === "approval_required" ? approvalChoices() : undefined,
    capabilities: ["voice_transcript", "agent_handoff", "approval_gate", "hud_render"],
    widget,
    created_at: event.createdAt,
  };
  return {
    schema: "peripheral-agentphone-event-v1",
    event: agentEvent,
    widget,
    command: commandForAgentPhoneEvent(event, widget),
    raw: event,
  };
}

function localCallHandle(reviewReason: string, requestBody: Record<string, unknown>): AgentPhoneCallHandle {
  return {
    mode: "phone_gateway",
    ok: true,
    callId: "local-dinner-booking",
    endpoint: null,
    requestBody,
    reviewReason,
  };
}

function buildAgentPhoneCallBody(request: AgentPhoneDinnerRequest, env: Record<string, string | undefined>, now: Date): Record<string, unknown> {
  return {
    schema: "peripheral-agentphone-dinner-call-v1",
    to: request.restaurantPhoneNumber,
    from: env.AGENTPHONE_PHONE_NUMBER,
    task: "restaurant_reservation",
    prompt: request.prompt,
    instructions: [
      "Call " + request.restaurantName + " near " + request.neighborhood + ".",
      "Ask for dinner for " + request.partySize + " tonight under " + request.bookingName + ".",
      "When the venue offers a time, pause for Peripheral glasses approval before confirming.",
      "Do not confirm the reservation until the wearer approves the focused approval card.",
    ].join(" "),
    metadata: {
      peripheral_demo: "dinner-booking",
      restaurant_name: request.restaurantName,
      party_size: request.partySize,
      booking_name: request.bookingName,
      preferred_window: request.preferredWindow,
      requested_at: now.toISOString(),
    },
  };
}

function agentPhoneCallsEndpoint(env: Record<string, string | undefined>): string {
  const base = (env.AGENTPHONE_API_URL || "https://api.agentphone.com/v1").replace(/\/+$/, "");
  return base.endsWith("/calls") ? base : base + "/calls";
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function eventsFromAgentPhoneBody(body: unknown, request: AgentPhoneDinnerRequest, callId: string, now: Date): AgentPhoneCallEvent[] {
  const record = asRecord(body);
  const rawEvents = arrayField(record, ["events", "items", "data"]);
  const events = rawEvents.flatMap((item) => eventFromRawAgentPhoneItem(item, request, callId, now)).filter(Boolean) as AgentPhoneCallEvent[];
  const transcript = stringField(record, ["transcript", "summary", "latest_transcript", "text"]);
  if (transcript) {
    events.push(eventFromTranscript(transcript, request, callId, now, body, true));
  }
  const status = stringField(record, ["status", "state"]);
  if (status && !events.length) {
    events.push({
      id: "agentphone_call_started",
      kind: status.toLowerCase().includes("connect") ? "call_connected" : "call_started",
      sessionId: "dinner-booking",
      callId,
      restaurantName: request.restaurantName,
      restaurantPhoneNumber: request.restaurantPhoneNumber,
      partySize: request.partySize,
      bookingName: request.bookingName,
      selectedTime: request.preferredWindow,
      text: status.toLowerCase().includes("connect") ? "Connected to " + request.restaurantName + "." : "Calling " + request.restaurantName + "...",
      status: status.toUpperCase(),
      real: true,
      raw: body,
      createdAt: now.toISOString(),
    });
  }
  return events;
}

function eventFromRawAgentPhoneItem(item: unknown, request: AgentPhoneDinnerRequest, callId: string, now: Date): AgentPhoneCallEvent | null {
  const record = asRecord(item);
  const text = stringField(record, ["text", "transcript", "summary", "message", "body"]);
  const type = (stringField(record, ["type", "kind", "event", "status"]) || "").toLowerCase();
  const createdAt = stringField(record, ["created_at", "createdAt", "timestamp"]) || now.toISOString();
  if (!text && !type) return null;
  if (type.includes("approval") || /7:45|8:15|available|offer/i.test(text || "")) {
    return {
      id: "booking-approval-1",
      kind: "approval_required",
      sessionId: "dinner-booking",
      callId,
      restaurantName: request.restaurantName,
      restaurantPhoneNumber: request.restaurantPhoneNumber,
      partySize: request.partySize,
      bookingName: request.bookingName,
      selectedTime: request.preferredWindow,
      offeredTimes: [request.preferredWindow, "8:15"],
      text: "Approve booking " + request.preferredWindow + " for " + request.partySize + "?",
      status: "WAITING_FOR_APPROVAL",
      real: true,
      raw: item,
      createdAt,
    };
  }
  if (type.includes("connect")) {
    return {
      id: "agentphone_call_connected",
      kind: "call_connected",
      sessionId: "dinner-booking",
      callId,
      restaurantName: request.restaurantName,
      restaurantPhoneNumber: request.restaurantPhoneNumber,
      partySize: request.partySize,
      bookingName: request.bookingName,
      selectedTime: request.preferredWindow,
      text: text || "Connected to " + request.restaurantName + ".",
      status: "CONNECTED",
      real: true,
      raw: item,
      createdAt,
    };
  }
  return eventFromTranscript(text || type, request, callId, now, item, true);
}

function eventFromTranscript(text: string, request: AgentPhoneDinnerRequest, callId: string, now: Date, raw: unknown, real: boolean): AgentPhoneCallEvent {
  return {
    id: "agentphone_transcript",
    kind: "transcript",
    sessionId: "dinner-booking",
    callId,
    restaurantName: request.restaurantName,
    restaurantPhoneNumber: request.restaurantPhoneNumber,
    partySize: request.partySize,
    bookingName: request.bookingName,
    selectedTime: request.preferredWindow,
    offeredTimes: [request.preferredWindow, "8:15"],
    text,
    status: "CONNECTED",
    real,
    raw,
    createdAt: now.toISOString(),
  };
}

function ensureApprovalEvent(events: AgentPhoneCallEvent[], request: AgentPhoneDinnerRequest, callId: string, now: Date): AgentPhoneCallEvent[] {
  const out = events.length ? [...events] : localAgentPhoneEvents(request, callId, now).slice(0, 2);
  if (!out.some((event) => event.kind === "approval_required")) {
    out.push(localAgentPhoneEvents(request, callId, now)[2]!);
  }
  return out;
}

function widgetForAgentPhoneEvent(event: AgentPhoneCallEvent): PeripheralWidget {
  if (event.kind === "approval_required") {
    return assertWidget({
      id: event.id,
      type: "approval_card",
      title: "Approve Reservation?",
      status: "WAITING_FOR_APPROVAL",
      body: cleanText(event.text, 180),
      choices: approvalChoices(),
      footer: event.restaurantName + " · " + (event.bookingName || "guest"),
      source: "AgentPhone",
      created_at: event.createdAt,
    });
  }
  return assertWidget({
    id: "agentphone-" + event.id,
    type: "live_call",
    title: event.restaurantName,
    status: event.status || (event.kind === "call_started" ? "CALLING" : "CONNECTED"),
    transcript: transcriptForEvent(event),
    facts: [
      (event.partySize || 2) + " guests",
      event.selectedTime ? "Option " + event.selectedTime : "Awaiting time",
      event.real ? "AgentPhone live path" : "Phone gateway broker route",
    ],
    source: "AgentPhone",
    created_at: event.createdAt,
  });
}

function transcriptForEvent(event: AgentPhoneCallEvent): Array<{ speaker: string; text: string }> {
  if (event.kind === "call_started") {
    return [{ speaker: "agent", text: cleanText(event.text, 90) }];
  }
  return [
    { speaker: "agent", text: "Checking availability for " + (event.partySize || 2) + "." },
    { speaker: "other", text: cleanText(event.text, 90) },
  ];
}

function commandForAgentPhoneEvent(event: AgentPhoneCallEvent, widget: PeripheralWidget): SurfaceCommand {
  const approval = event.kind === "approval_required";
  const surface: SurfaceKind = approval ? "fullscreen" : event.kind === "call_started" ? "tiny_hud" : "glance";
  return {
    kind: approval ? "show_card" : "show_widget",
    id: "agentphone-command-" + event.id,
    mode: "agent_mode",
    surface,
    widget: approval ? undefined : widget,
    card: approval ? widget : undefined,
    source: sourceFor("agentphone", event.sessionId),
    decision_required: approval,
    reason: approval ? "Venue offered a time and the agent must wait for wearer approval." : "AgentPhone call event updated dinner booking state.",
    created_at: event.createdAt,
  };
}

function titleForAgentPhoneEvent(event: AgentPhoneCallEvent): string {
  switch (event.kind) {
    case "call_started":
      return "Calling Restaurant";
    case "approval_required":
      return "Approve Booking?";
    case "call_completed":
      return "Call Complete";
    case "call_error":
      return "Call Error";
    default:
      return "Restaurant Call";
  }
}

function approvalChoices() {
  return [
    { id: "approve", label: "Approve", tone: "primary" as const },
    { id: "deny", label: "Deny", tone: "danger" as const },
    { id: "details", label: "Details", tone: "secondary" as const },
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayField(record: Record<string, unknown>, names: string[]): unknown[] {
  for (const name of names) {
    const value = record[name];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function stringField(value: unknown, names: string[]): string | undefined {
  const record = asRecord(value);
  for (const name of names) {
    const field = record[name];
    if (typeof field === "string" && field.trim()) return field;
    if (typeof field === "number" && Number.isFinite(field)) return String(field);
  }
  return undefined;
}
