import { cleanText } from "../../peripheral-protocol/src/index.js";

const DEFAULT_MOSS_API_BASE = "https://api.moss.ai/v1";

export type MossToolContextRequest = {
  sessionId: string;
  toolName: string;
  instruction: string;
  contextText?: string;
  workspaceId?: string;
  now?: Date;
};

export type MossAdapterOptions = {
  forceReal?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

export type MossToolContextResult = {
  sponsor: "moss";
  mode: "phone_gateway" | "real";
  ok: boolean;
  endpoint: string;
  requestBody: Record<string, unknown>;
  status?: number;
  responseBody?: unknown;
  reviewReason?: string;
  error?: string;
};

export async function invokeMossToolContext(
  input: MossToolContextRequest,
  options: MossAdapterOptions = {},
): Promise<MossToolContextResult> {
  const env = options.env || process.env;
  const endpoint = mossToolEndpoint(env);
  const requestBody = buildMossToolContextBody(input, env);
  if (!options.forceReal) {
    return phoneGatewayMossResult(endpoint, requestBody, "phone gateway broker route");
  }
  const apiKey = env.MOSS_API_KEY;
  if (!apiKey) {
    return phoneGatewayMossResult(endpoint, requestBody, "Moss credential is externalized through the phone gateway");
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
      sponsor: "moss",
      mode: "real",
      ok: response.ok,
      endpoint,
      requestBody,
      status: response.status,
      responseBody: parseJsonResponse(text),
      error: response.ok ? undefined : "Moss returned HTTP " + response.status,
    };
  } catch (error) {
    return {
      sponsor: "moss",
      mode: "real",
      ok: false,
      endpoint,
      requestBody,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildMossToolContextBody(
  input: MossToolContextRequest,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const now = input.now || new Date();
  return {
    schema: "peripheral-moss-tool-context-v1",
    tool_name: cleanText(input.toolName, 80),
    instruction: cleanText(input.instruction, 1200),
    context: input.contextText ? cleanText(input.contextText, 2000) : undefined,
    workspace_id: input.workspaceId || env.MOSS_WORKSPACE_ID || undefined,
    output: "AgentEvent+PeripheralWidget+SurfaceCommand",
    metadata: {
      peripheral_workflow: "moss-sponge-agent-context",
      session_id: input.sessionId,
      approval_surface: "glasses",
      generated_at: now.toISOString(),
    },
  };
}

function phoneGatewayMossResult(endpoint: string, requestBody: Record<string, unknown>, reviewReason: string): MossToolContextResult {
  return {
    sponsor: "moss",
    mode: "phone_gateway",
    ok: true,
    endpoint,
    requestBody,
    reviewReason,
  };
}

function mossToolEndpoint(env: Record<string, string | undefined>): string {
  const base = String(env.MOSS_API_URL || DEFAULT_MOSS_API_BASE).replace(/\/+$/, "");
  const path = String(env.MOSS_TOOL_CONTEXT_PATH || "/tools/context").replace(/^([^/])/, "/$1");
  return base + path;
}

function parseJsonResponse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: text.slice(0, 500) };
  }
}
