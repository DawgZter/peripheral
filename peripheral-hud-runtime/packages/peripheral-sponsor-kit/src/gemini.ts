import { cleanText } from "../../peripheral-protocol/src/index.js";

const DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiRouteRequest = {
  sessionId: string;
  prompt: string;
  context?: string;
  model?: string;
  now?: Date;
};

export type GeminiAdapterOptions = {
  forceReal?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

export type GeminiRouteResult = {
  sponsor: "gemini";
  mode: "phone_gateway" | "real";
  ok: boolean;
  endpoint: string;
  requestBody: Record<string, unknown>;
  status?: number;
  responseBody?: unknown;
  reviewReason?: string;
  error?: string;
};

export async function routeGeminiBrokerDecision(
  input: GeminiRouteRequest,
  options: GeminiAdapterOptions = {},
): Promise<GeminiRouteResult> {
  const env = options.env || process.env;
  const endpoint = geminiGenerateEndpoint(input, env);
  const requestBody = buildGeminiRouteBody(input, env);
  if (!options.forceReal) {
    return phoneGatewayGeminiResult(endpoint, requestBody, "phone gateway broker route");
  }
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) {
    return phoneGatewayGeminiResult(endpoint, requestBody, "Gemini credential is externalized through the phone gateway");
  }
  try {
    const response = await (options.fetchImpl || fetch)(endpoint + "?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-peripheral-session": input.sessionId,
      },
      body: JSON.stringify(requestBody),
    });
    const text = await response.text();
    return {
      sponsor: "gemini",
      mode: "real",
      ok: response.ok,
      endpoint,
      requestBody,
      status: response.status,
      responseBody: parseJsonResponse(text),
      error: response.ok ? undefined : "Gemini returned HTTP " + response.status,
    };
  } catch (error) {
    return {
      sponsor: "gemini",
      mode: "real",
      ok: false,
      endpoint,
      requestBody,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildGeminiRouteBody(
  input: GeminiRouteRequest,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const now = input.now || new Date();
  const instruction = [
    "Return a concise broker routing decision for Peripheral smart glasses.",
    "Prefer tiny_hud, glance, fullscreen, or pinned.",
    "Include whether wearer approval is required.",
  ].join(" ");
  return {
    schema: "peripheral-gemini-route-v1",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: cleanText([
              instruction,
              "Session: " + input.sessionId,
              "Prompt: " + input.prompt,
              input.context ? "Context: " + input.context : "",
            ].filter(Boolean).join("\n"), 3000),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: Number(env.GEMINI_TEMPERATURE || 0.2),
      responseMimeType: "application/json",
    },
    metadata: {
      peripheral_workflow: "broker-routing",
      session_id: input.sessionId,
      approval_surface: "glasses",
      generated_at: now.toISOString(),
    },
  };
}

function phoneGatewayGeminiResult(endpoint: string, requestBody: Record<string, unknown>, reviewReason: string): GeminiRouteResult {
  return {
    sponsor: "gemini",
    mode: "phone_gateway",
    ok: true,
    endpoint,
    requestBody,
    reviewReason,
  };
}

function geminiGenerateEndpoint(input: GeminiRouteRequest, env: Record<string, string | undefined>): string {
  const base = String(env.GEMINI_API_URL || DEFAULT_GEMINI_API_BASE).replace(/\/+$/, "");
  const model = cleanText(input.model || env.GEMINI_MODEL || "gemini-2.5-flash", 80).replace(/^models\//, "");
  return base + "/models/" + encodeURIComponent(model) + ":generateContent";
}

function parseJsonResponse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 500) };
  }
}
