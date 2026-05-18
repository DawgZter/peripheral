import {
  assertWidget,
  cleanText,
  type AgentEvent,
  type PeripheralWidget,
  type SurfaceCommand,
  type SurfaceKind,
} from "../../peripheral-protocol/src/index.js";
import { sourceFor } from "../../peripheral-integrations/src/index.js";

const DEFAULT_BROWSER_USE_API_BASE = "https://api.browser-use.com/api/v3";

export type BrowserUseTaskRequest = {
  sessionId: string;
  task: string;
  startUrl?: string;
  model?: string;
  profileId?: string;
  workspaceId?: string;
  maxCostUsd?: string | number;
  proxyCountryCode?: string;
  keepAlive?: boolean;
  outputSchema?: Record<string, unknown>;
  approvalIntent?: string;
  now?: Date;
};

export type BrowserUseAdapterOptions = {
  forceReal?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  pollSession?: boolean;
};

export type BrowserUseTaskEventKind =
  | "browser_step"
  | "browser_submit_requested"
  | "browser_result"
  | "browser_error";

export type BrowserUseTaskEvent = {
  id: string;
  kind: BrowserUseTaskEventKind;
  sessionId: string;
  browserSessionId?: string;
  task: string;
  title: string;
  text: string;
  status: string;
  stepCount?: number;
  liveUrl?: string;
  recordingUrls?: string[];
  real: boolean;
  raw?: unknown;
  createdAt: string;
};

export type BrowserUseTaskResult = {
  sponsor: "browser_use";
  mode: "phone_gateway" | "real";
  ok: boolean;
  endpoint: string;
  requestBody: Record<string, unknown>;
  browserSessionId?: string;
  status?: number;
  responseBody?: unknown;
  events: BrowserUseTaskEvent[];
  reviewReason?: string;
  error?: string;
};

export type NormalizedBrowserUseEvent = {
  schema: "peripheral-browser-use-event-v1";
  event: AgentEvent;
  widget: PeripheralWidget;
  command: SurfaceCommand;
  raw: BrowserUseTaskEvent;
};

export async function runBrowserUseTask(
  input: BrowserUseTaskRequest,
  options: BrowserUseAdapterOptions = {},
): Promise<BrowserUseTaskResult> {
  const env = options.env || process.env;
  const now = input.now || new Date();
  const endpoint = browserUseSessionsEndpoint(env);
  const requestBody = buildBrowserUseTaskBody(input, env);
  if (!options.forceReal) {
    return localBrowserUseResult(endpoint, requestBody, input, now, "phone gateway broker route");
  }
  const apiKey = env.BROWSER_USE_API_KEY;
  if (!apiKey) {
    return localBrowserUseResult(endpoint, requestBody, input, now, "Browser Use credential is externalized through the phone gateway");
  }
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: "POST",
      headers: {
        "x-browser-use-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
        "x-peripheral-session": input.sessionId,
      },
      body: JSON.stringify(requestBody),
    });
    const text = await response.text();
    let body = parseJsonResponse(text);
    const browserSessionId = stringField(body, ["id", "session_id", "sessionId"]) || input.sessionId;
    if (response.ok && options.pollSession !== false && browserSessionId) {
      body = await pollBrowserUseSession(browserSessionId, env, options.fetchImpl || fetch, body);
    }
    return {
      sponsor: "browser_use",
      mode: "real",
      ok: response.ok,
      endpoint,
      requestBody,
      browserSessionId,
      status: response.status,
      responseBody: body,
      events: eventsFromBrowserUseBody(body, input, browserSessionId, now, true),
      error: response.ok ? undefined : "Browser Use returned HTTP " + response.status,
    };
  } catch (error) {
    return {
      sponsor: "browser_use",
      mode: "real",
      ok: false,
      endpoint,
      requestBody,
      events: localBrowserUseEvents(input, input.sessionId, now),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildBrowserUseTaskBody(
  input: BrowserUseTaskRequest,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const task = cleanText([input.startUrl ? "Start at " + input.startUrl + "." : "", input.task].filter(Boolean).join(" "), 2000);
  return stripUndefined({
    task,
    model: input.model || env.BROWSER_USE_MODEL || "gemini-3-flash",
    sessionId: env.BROWSER_USE_SESSION_ID || undefined,
    keepAlive: input.keepAlive ?? env.BROWSER_USE_KEEP_ALIVE === "1",
    maxCostUsd: input.maxCostUsd || env.BROWSER_USE_MAX_COST_USD || "1.00",
    profileId: input.profileId || env.BROWSER_USE_PROFILE_ID || undefined,
    workspaceId: input.workspaceId || env.BROWSER_USE_WORKSPACE_ID || undefined,
    proxyCountryCode: input.proxyCountryCode || env.BROWSER_USE_PROXY_COUNTRY || "us",
    outputSchema: input.outputSchema || browserUseOutputSchema(),
    metadata: {
      peripheral_schema: "peripheral-browser-use-task-v1",
      peripheral_workflow: "approval-gated-browser-task",
      session_id: input.sessionId,
      approval_surface: "glasses",
      approval_intent: input.approvalIntent || "pause before submits, purchases, account changes, or sensitive form sends",
      generated_at: (input.now || new Date()).toISOString(),
    },
  });
}

export function localBrowserUseEvents(
  input: BrowserUseTaskRequest,
  browserSessionId = "local-browser-task",
  now = input.now || new Date(),
): BrowserUseTaskEvent[] {
  const timestamp = now.toISOString();
  return [
    {
      id: "browser-use-step-1",
      kind: "browser_step",
      sessionId: input.sessionId,
      browserSessionId,
      task: input.task,
      title: "Browser Task Running",
      text: cleanText(input.startUrl ? "Opened " + input.startUrl + " and started task evidence capture." : "Started browser task evidence capture.", 160),
      status: "RUNNING",
      stepCount: 1,
      liveUrl: undefined,
      real: false,
      createdAt: timestamp,
    },
    {
      id: "browser-use-approval-1",
      kind: "browser_submit_requested",
      sessionId: input.sessionId,
      browserSessionId,
      task: input.task,
      title: "Approve Browser Submit?",
      text: cleanText(input.approvalIntent || "Browser task is paused before a sensitive submit or account mutation.", 180),
      status: "WAITING_FOR_APPROVAL",
      stepCount: 2,
      real: false,
      createdAt: timestamp,
    },
  ];
}

export function normalizeBrowserUseEvent(event: BrowserUseTaskEvent): NormalizedBrowserUseEvent {
  const source = sourceFor("browser_use", event.sessionId);
  const risk = event.kind === "browser_submit_requested" ? "high" : event.kind === "browser_error" ? "medium" : "low";
  const widget = widgetForBrowserUseEvent(event);
  const agentEvent: AgentEvent = {
    kind: event.kind === "browser_submit_requested" ? "approval_required" : event.kind === "browser_error" ? "session_error" : event.kind === "browser_result" ? "session_completed" : "session_progress",
    id: event.id,
    source,
    session_id: event.sessionId,
    title: event.title,
    summary: cleanText(event.text, 220),
    status: event.kind === "browser_submit_requested" ? "waiting" : event.kind === "browser_error" ? "error" : event.kind === "browser_result" ? "completed" : "running",
    risk,
    choices: event.kind === "browser_submit_requested" ? approvalChoices() : undefined,
    capabilities: ["browser_session", "approval_gate", "hud_render", "live_status"],
    widget,
    created_at: event.createdAt,
  };
  return {
    schema: "peripheral-browser-use-event-v1",
    event: agentEvent,
    widget,
    command: commandForBrowserUseEvent(event, widget),
    raw: event,
  };
}

async function pollBrowserUseSession(
  browserSessionId: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  fallback: unknown,
): Promise<unknown> {
  const apiKey = env.BROWSER_USE_API_KEY;
  if (!apiKey) return fallback;
  try {
    const response = await fetchImpl(browserUseSessionsEndpoint(env) + "/" + encodeURIComponent(browserSessionId), {
      headers: {
        "x-browser-use-api-key": apiKey,
        accept: "application/json",
      },
    });
    const text = await response.text();
    return parseJsonResponse(text) || fallback;
  } catch {
    return fallback;
  }
}

function eventsFromBrowserUseBody(
  body: unknown,
  input: BrowserUseTaskRequest,
  browserSessionId: string,
  now: Date,
  real: boolean,
): BrowserUseTaskEvent[] {
  const record = isRecord(body) ? body : {};
  const status = cleanText(String(record.status || "running"), 32).toUpperCase();
  const lastStep = stringField(record, ["lastStepSummary", "last_step_summary", "summary", "title"]);
  const outputText = outputSummary(record.output);
  const liveUrl = stringField(record, ["liveUrl", "live_url"]);
  const stepCount = numberField(record, ["stepCount", "step_count"]);
  const base: BrowserUseTaskEvent = {
    id: "browser-use-step-" + (browserSessionId || input.sessionId),
    kind: status.includes("ERROR") ? "browser_error" : outputText ? "browser_result" : "browser_step",
    sessionId: input.sessionId,
    browserSessionId,
    task: input.task,
    title: outputText ? "Browser Result Ready" : status.includes("ERROR") ? "Browser Task Error" : "Browser Task Running",
    text: cleanText(outputText || lastStep || "Browser Use session " + status.toLowerCase() + ".", 220),
    status,
    stepCount,
    liveUrl,
    recordingUrls: Array.isArray(record.recordingUrls) ? record.recordingUrls.filter((value): value is string => typeof value === "string") : undefined,
    real,
    raw: body,
    createdAt: now.toISOString(),
  };
  const events = [base];
  if (!outputText && !status.includes("ERROR")) {
    events.push({
      id: "browser-use-approval-" + (browserSessionId || input.sessionId),
      kind: "browser_submit_requested",
      sessionId: input.sessionId,
      browserSessionId,
      task: input.task,
      title: "Approve Browser Submit?",
      text: cleanText(input.approvalIntent || "Approve the next sensitive browser action before it continues.", 180),
      status: "WAITING_FOR_APPROVAL",
      stepCount,
      liveUrl,
      real,
      raw: body,
      createdAt: now.toISOString(),
    });
  }
  return events;
}

function localBrowserUseResult(
  endpoint: string,
  requestBody: Record<string, unknown>,
  input: BrowserUseTaskRequest,
  now: Date,
  reviewReason: string,
): BrowserUseTaskResult {
  return {
    sponsor: "browser_use",
    mode: "phone_gateway",
    ok: true,
    endpoint,
    requestBody,
    browserSessionId: "local-browser-task",
    events: localBrowserUseEvents(input, "local-browser-task", now),
    reviewReason,
  };
}

function widgetForBrowserUseEvent(event: BrowserUseTaskEvent): PeripheralWidget {
  if (event.kind === "browser_submit_requested") {
    return assertWidget({
      id: event.id,
      type: "approval_card",
      title: event.title,
      status: "APPROVAL",
      body: event.text,
      choices: approvalChoices(),
      source: "Browser Use",
      created_at: event.createdAt,
    });
  }
  return assertWidget({
    id: event.id,
    type: "generic_card",
    title: event.title,
    status: event.status,
    body: event.text,
    footer: [event.stepCount !== undefined ? "Step " + event.stepCount : "", event.liveUrl ? "Live session attached" : ""].filter(Boolean).join(" / "),
    source: "Browser Use",
    created_at: event.createdAt,
  });
}

function commandForBrowserUseEvent(event: BrowserUseTaskEvent, widget: PeripheralWidget): SurfaceCommand {
  const surface: SurfaceKind = event.kind === "browser_submit_requested" ? "fullscreen" : "glance";
  return {
    kind: event.kind === "browser_submit_requested" ? "show_card" : "show_widget",
    id: "surface-" + event.id,
    mode: "agent_mode",
    surface,
    widget,
    card: event.kind === "browser_submit_requested" ? widget : undefined,
    source: sourceFor("browser_use", event.sessionId),
    decision_required: event.kind === "browser_submit_requested",
    reason: event.kind === "browser_submit_requested" ? "Sensitive browser action is blocked on wearer approval." : "Browser task evidence update.",
    created_at: event.createdAt,
  };
}

function browserUseSessionsEndpoint(env: Record<string, string | undefined>): string {
  const base = String(env.BROWSER_USE_API_URL || DEFAULT_BROWSER_USE_API_BASE).replace(/\/+$/, "");
  const path = String(env.BROWSER_USE_SESSIONS_PATH || "/sessions").replace(/^([^/])/, "/$1");
  return base + path;
}

function browserUseOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: true,
    properties: {
      summary: { type: "string" },
      next_approval: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
    },
  };
}

function approvalChoices() {
  return [
    { id: "approve", label: "Approve", tone: "primary" as const },
    { id: "deny", label: "Deny", tone: "danger" as const },
    { id: "details", label: "Details", tone: "secondary" as const },
  ];
}

function outputSummary(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    const direct = stringField(value, ["summary", "text", "result"]);
    if (direct) return direct;
    try {
      return JSON.stringify(value).slice(0, 220);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseJsonResponse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 500) };
  }
}

function stringField(body: unknown, names: string[]): string | undefined {
  const record = isRecord(body) ? body : {};
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function numberField(body: unknown, names: string[]): number | undefined {
  const record = isRecord(body) ? body : {};
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
