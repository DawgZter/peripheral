import { cleanText } from "../../peripheral-protocol/src/index.js";

const DEFAULT_SPONGE_API_BASE = "https://api.sponge.ai/v1";

export type SpongeContextRequest = {
  sessionId: string;
  text: string;
  projectId?: string;
  redactionMode?: "context_digest" | "redaction_warning" | "safe_summary";
  now?: Date;
};

export type SpongeAdapterOptions = {
  forceReal?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

export type SpongeContextResult = {
  sponsor: "sponge";
  mode: "phone_gateway" | "real";
  ok: boolean;
  endpoint: string;
  requestBody: Record<string, unknown>;
  status?: number;
  responseBody?: unknown;
  reviewReason?: string;
  error?: string;
};

export async function submitSpongeContext(
  input: SpongeContextRequest,
  options: SpongeAdapterOptions = {},
): Promise<SpongeContextResult> {
  const env = options.env || process.env;
  const endpoint = spongeContextEndpoint(env);
  const requestBody = buildSpongeContextBody(input, env);
  if (!options.forceReal) {
    return phoneGatewaySpongeResult(endpoint, requestBody, "phone gateway broker route");
  }
  const apiKey = env.SPONGE_API_KEY;
  if (!apiKey) {
    return phoneGatewaySpongeResult(endpoint, requestBody, "Sponge credential is externalized through the phone gateway");
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
      sponsor: "sponge",
      mode: "real",
      ok: response.ok,
      endpoint,
      requestBody,
      status: response.status,
      responseBody: parseJsonResponse(text),
      error: response.ok ? undefined : "Sponge returned HTTP " + response.status,
    };
  } catch (error) {
    return {
      sponsor: "sponge",
      mode: "real",
      ok: false,
      endpoint,
      requestBody,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildSpongeContextBody(
  input: SpongeContextRequest,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const now = input.now || new Date();
  return {
    schema: "peripheral-sponge-context-v1",
    mode: input.redactionMode || "context_digest",
    text: cleanText(input.text, 2000),
    project_id: input.projectId || env.SPONGE_PROJECT_ID || undefined,
    output: "AgentEvent+PeripheralWidget+SurfaceCommand",
    metadata: {
      peripheral_workflow: "context-safety-surface",
      session_id: input.sessionId,
      approval_surface: "glasses",
      generated_at: now.toISOString(),
    },
  };
}

function phoneGatewaySpongeResult(endpoint: string, requestBody: Record<string, unknown>, reviewReason: string): SpongeContextResult {
  return {
    sponsor: "sponge",
    mode: "phone_gateway",
    ok: true,
    endpoint,
    requestBody,
    reviewReason,
  };
}

function spongeContextEndpoint(env: Record<string, string | undefined>): string {
  const base = String(env.SPONGE_API_URL || DEFAULT_SPONGE_API_BASE).replace(/\/+$/, "");
  const path = String(env.SPONGE_CONTEXT_PATH || "/context").replace(/^([^/])/, "/$1");
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
