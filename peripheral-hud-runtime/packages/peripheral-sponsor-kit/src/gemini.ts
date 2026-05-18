import {
  assertWidget,
  cleanText,
  type AgentEvent,
  type PeripheralWidget,
  type SurfaceCommand,
  type SurfaceKind,
} from "../../peripheral-protocol/src/index.js";
import { sourceFor } from "../../peripheral-integrations/src/index.js";

const DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiRouteRequest = {
  sessionId: string;
  prompt?: string;
  wearerInput?: string;
  focusedCardId?: string;
  activeAgents?: string[];
  context?: string;
  model?: string;
  now?: Date;
};

export type GeminiAdapterOptions = {
  forceReal?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

export type GeminiRouteDecision = {
  summary: string;
  route: "focused_card" | "named_agent" | "app_mode" | "broker";
  target?: string;
  surface: SurfaceKind;
  reason: string;
};

export type GeminiRouteResult = {
  sponsor: "gemini";
  mode: "phone_gateway" | "real";
  ok: boolean;
  endpoint: string;
  requestBody: Record<string, unknown>;
  decision: GeminiRouteDecision;
  status?: number;
  responseBody?: unknown;
  reviewReason?: string;
  error?: string;
};

export type NormalizedGeminiRoute = {
  schema: "peripheral-gemini-route-v1";
  event: AgentEvent;
  widget: PeripheralWidget;
  command: SurfaceCommand;
  decision: GeminiRouteDecision;
};

export async function routeGeminiBrokerDecision(
  input: GeminiRouteRequest,
  options: GeminiAdapterOptions = {},
): Promise<GeminiRouteResult> {
  return routeWithGemini(input, options);
}

export async function routeWithGemini(
  input: GeminiRouteRequest,
  options: GeminiAdapterOptions = {},
): Promise<GeminiRouteResult> {
  const env = options.env || process.env;
  const model = cleanText(input.model || env.GEMINI_MODEL || "gemini-2.5-flash", 80).replace(/^models\//, "");
  const endpoint = geminiGenerateEndpoint(env, model);
  const requestBody = buildGeminiRouteBody(input, env);
  if (!options.forceReal) {
    return phoneGatewayGeminiResult(endpoint, requestBody, input, "phone gateway broker route");
  }
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) {
    return phoneGatewayGeminiResult(endpoint, requestBody, input, "Gemini credential is externalized through the phone gateway");
  }
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
        "x-peripheral-session": input.sessionId,
      },
      body: JSON.stringify(requestBody),
    });
    const text = await response.text();
    const body = parseJsonResponse(text);
    return {
      sponsor: "gemini",
      mode: "real",
      ok: response.ok,
      endpoint,
      requestBody,
      decision: decisionFromGeminiBody(body, input),
      status: response.status,
      responseBody: body,
      error: response.ok ? undefined : "Gemini returned HTTP " + response.status,
    };
  } catch (error) {
    return {
      sponsor: "gemini",
      mode: "real",
      ok: false,
      endpoint,
      requestBody,
      decision: localGeminiDecision(input),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildGeminiRouteBody(
  input: GeminiRouteRequest,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const now = input.now || new Date();
  const text = requestText(input);
  const prompt = [
    "You are the Peripheral glasses broker brain. Return only JSON.",
    "Route wearer input to one of: focused_card, named_agent, app_mode, broker.",
    "Pick one surface: tiny_hud, glance, fullscreen, pinned.",
    "Keep summary under 80 chars and reason under 140 chars.",
    "wearer_input: " + text,
    "focused_card_id: " + (input.focusedCardId || "none"),
    "active_agents: " + (input.activeAgents || []).join(", "),
    "context: " + (input.context || "agent-mode glasses runtime"),
  ].join("\n");
  return {
    schema: "peripheral-gemini-route-v1",
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: Number(env.GEMINI_TEMPERATURE || 0.2),
      responseMimeType: "application/json",
    },
    systemInstruction: {
      parts: [
        {
          text: "Peripheral agents request semantic UI. The phone runtime owns display leases and approval focus.",
        },
      ],
    },
    metadata: {
      peripheral_workflow: "broker-routing",
      session_id: input.sessionId,
      approval_surface: "glasses",
      generated_at: now.toISOString(),
    },
  };
}

export function normalizeGeminiRoute(result: GeminiRouteResult, input: GeminiRouteRequest): NormalizedGeminiRoute {
  const now = input.now || new Date();
  const source = sourceFor("gemini", input.sessionId);
  const widget = widgetForGeminiDecision(result.decision, input, now);
  const event: AgentEvent = {
    kind: "session_progress",
    id: "gemini-route-" + slug(input.sessionId),
    source,
    session_id: input.sessionId,
    title: "Gemini Route",
    summary: cleanText(result.decision.summary, 220),
    status: "running",
    risk: "low",
    capabilities: ["hud_render", "live_status"],
    widget,
    created_at: now.toISOString(),
  };
  return {
    schema: "peripheral-gemini-route-v1",
    event,
    widget,
    command: {
      kind: "show_widget",
      id: "surface-gemini-route-" + slug(input.sessionId),
      mode: "agent_mode",
      surface: result.decision.surface,
      widget,
      source,
      decision_required: false,
      reason: cleanText(result.decision.reason, 180),
      created_at: now.toISOString(),
    },
    decision: result.decision,
  };
}

function phoneGatewayGeminiResult(
  endpoint: string,
  requestBody: Record<string, unknown>,
  input: GeminiRouteRequest,
  reviewReason: string,
): GeminiRouteResult {
  return {
    sponsor: "gemini",
    mode: "phone_gateway",
    ok: true,
    endpoint,
    requestBody,
    decision: localGeminiDecision(input),
    reviewReason,
  };
}

function localGeminiDecision(input: GeminiRouteRequest): GeminiRouteDecision {
  const lower = requestText(input).toLowerCase();
  const named = (input.activeAgents || []).find((agent) => lower.includes(agent.toLowerCase().replace(/[_-]+/g, " "))) ||
    (lower.includes("codex") ? "codex_cli" : lower.includes("claude") ? "claude_code" : lower.includes("gemini") ? "gemini_cli" : undefined);
  if (input.focusedCardId && /approve|deny|details/.test(lower)) {
    return {
      summary: "Route reply to focused approval",
      route: "focused_card",
      target: input.focusedCardId,
      surface: "tiny_hud",
      reason: "Focused approval card wins short approval replies.",
    };
  }
  if (named) {
    return {
      summary: "Route voice to " + named,
      route: "named_agent",
      target: named,
      surface: "tiny_hud",
      reason: "Wearer named an active agent in the command.",
    };
  }
  return {
    summary: "Broker handles wearer request",
    route: "broker",
    surface: "glance",
    reason: "No focused approval or named agent was detected.",
  };
}

function decisionFromGeminiBody(body: unknown, input: GeminiRouteRequest): GeminiRouteDecision {
  const text = geminiText(body);
  const parsed = parseDecision(text);
  if (!parsed) return localGeminiDecision(input);
  return {
    summary: cleanText(String(parsed.summary || "Gemini broker route ready"), 80),
    route: routeValue(parsed.route),
    target: typeof parsed.target === "string" ? cleanText(parsed.target, 80) : undefined,
    surface: surfaceValue(parsed.surface),
    reason: cleanText(String(parsed.reason || "Gemini returned a structured routing decision."), 140),
  };
}

function widgetForGeminiDecision(decision: GeminiRouteDecision, input: GeminiRouteRequest, now: Date): PeripheralWidget {
  return assertWidget({
    id: "gemini-route-" + slug(input.sessionId),
    type: "generic_card",
    title: "Gemini Broker",
    status: decision.route.toUpperCase(),
    body: decision.summary,
    footer: cleanText(decision.reason, 60),
    source: "Gemini",
    created_at: now.toISOString(),
  });
}

function geminiGenerateEndpoint(env: Record<string, string | undefined>, model: string): string {
  const base = String(env.GEMINI_API_URL || DEFAULT_GEMINI_API_BASE).replace(/\/+$/, "");
  return base + "/models/" + encodeURIComponent(model) + ":generateContent";
}

function geminiText(body: unknown): string {
  const record = isRecord(body) ? body : {};
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  for (const candidate of candidates) {
    const content = isRecord(candidate) ? candidate.content : undefined;
    const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
    const text = parts.map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("");
    if (text.trim()) return text;
  }
  return "";
}

function parseDecision(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function routeValue(value: unknown): GeminiRouteDecision["route"] {
  return value === "focused_card" || value === "named_agent" || value === "app_mode" || value === "broker" ? value : "broker";
}

function surfaceValue(value: unknown): SurfaceKind {
  return value === "tiny_hud" || value === "glance" || value === "fullscreen" || value === "pinned" ? value : "glance";
}

function parseJsonResponse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 500) };
  }
}

function requestText(input: GeminiRouteRequest): string {
  return cleanText(input.wearerInput || input.prompt || "Choose the best glasses surface for this agent update.", 1000);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "route";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
