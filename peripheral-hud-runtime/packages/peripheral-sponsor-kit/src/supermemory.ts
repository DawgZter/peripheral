import { cleanText } from "../../peripheral-protocol/src/index.js";

const DEFAULT_SUPERMEMORY_API_BASE = "https://api.supermemory.ai/v3";

export type SupermemoryPreferenceRequest = {
  sessionId: string;
  wearerName: string;
  preference: string;
  restaurantName?: string;
  bookingTime?: string;
  now?: Date;
};

export type SupermemoryAdapterOptions = {
  forceReal?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

export type SupermemorySaveResult = {
  sponsor: "supermemory";
  mode: "local_review" | "real";
  ok: boolean;
  endpoint: string;
  requestBody: Record<string, unknown>;
  status?: number;
  responseBody?: unknown;
  reviewReason?: string;
  error?: string;
};

export async function saveDinnerPreference(
  input: SupermemoryPreferenceRequest,
  options: SupermemoryAdapterOptions = {},
): Promise<SupermemorySaveResult> {
  const env = options.env || process.env;
  const endpoint = supermemorySaveEndpoint(env);
  const requestBody = buildSupermemoryPreferenceBody(input, env);
  if (!options.forceReal) {
    return localSupermemoryResult(endpoint, requestBody, "local review path");
  }
  const apiKey = env.SUPERMEMORY_API_KEY;
  if (!apiKey) {
    return localSupermemoryResult(endpoint, requestBody, "Supermemory credential is externalized for local review");
  }
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer " + apiKey,
        "content-type": "application/json",
        accept: "application/json",
        "x-peripheral-session": input.sessionId,
      },
      body: JSON.stringify(requestBody),
    });
    const text = await response.text();
    return {
      sponsor: "supermemory",
      mode: "real",
      ok: response.ok,
      endpoint,
      requestBody,
      status: response.status,
      responseBody: parseJsonResponse(text),
      error: response.ok ? undefined : "Supermemory returned HTTP " + response.status,
    };
  } catch (error) {
    return {
      sponsor: "supermemory",
      mode: "real",
      ok: false,
      endpoint,
      requestBody,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildSupermemoryPreferenceBody(
  input: SupermemoryPreferenceRequest,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const now = input.now || new Date();
  const content = cleanText(input.preference, 1000);
  return {
    schema: "peripheral-supermemory-save-v1",
    content,
    container: env.SUPERMEMORY_CONTAINER || env.SUPERMEMORY_CONTAINER_ID || undefined,
    tags: ["peripheral", "dinner-booking", "preference"],
    metadata: {
      peripheral_workflow: "dinner-booking",
      session_id: input.sessionId,
      wearer_name: input.wearerName,
      restaurant_name: input.restaurantName,
      booking_time: input.bookingTime,
      generated_at: now.toISOString(),
    },
  };
}

function localSupermemoryResult(endpoint: string, requestBody: Record<string, unknown>, reviewReason: string): SupermemorySaveResult {
  return {
    sponsor: "supermemory",
    mode: "local_review",
    ok: true,
    endpoint,
    requestBody,
    reviewReason,
  };
}

function supermemorySaveEndpoint(env: Record<string, string | undefined>): string {
  const base = String(env.SUPERMEMORY_API_URL || DEFAULT_SUPERMEMORY_API_BASE).replace(/\/+$/, "");
  const path = String(env.SUPERMEMORY_SAVE_PATH || "/memories").replace(/^([^/])/, "/$1");
  return base + path;
}

function parseJsonResponse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 500) };
  }
}
