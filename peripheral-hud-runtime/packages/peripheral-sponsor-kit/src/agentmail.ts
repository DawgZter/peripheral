import { cleanText } from "../../peripheral-protocol/src/index.js";

const DEFAULT_AGENTMAIL_API_BASE = "https://api.agentmail.to/v1";

export type AgentMailConfirmationRequest = {
  sessionId: string;
  restaurantName: string;
  bookingTime: string;
  partySize: number;
  bookingName: string;
  to?: string;
  from?: string;
  subject?: string;
  text?: string;
  now?: Date;
};

export type AgentMailAdapterOptions = {
  forceReal?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

export type AgentMailSendResult = {
  sponsor: "agentmail";
  mode: "phone_gateway" | "real";
  ok: boolean;
  endpoint: string;
  requestBody: Record<string, unknown>;
  status?: number;
  responseBody?: unknown;
  reviewReason?: string;
  error?: string;
};

export async function sendAgentMailConfirmation(
  input: AgentMailConfirmationRequest,
  options: AgentMailAdapterOptions = {},
): Promise<AgentMailSendResult> {
  const env = options.env || process.env;
  const endpoint = agentMailSendEndpoint(env);
  const requestBody = buildAgentMailConfirmationBody(input, env);
  if (!options.forceReal) {
    return localAgentMailResult(endpoint, requestBody, "phone gateway broker route");
  }
  const apiKey = env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    return localAgentMailResult(endpoint, requestBody, "AgentMail credential is externalized through the phone gateway");
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
      sponsor: "agentmail",
      mode: "real",
      ok: response.ok,
      endpoint,
      requestBody,
      status: response.status,
      responseBody: parseJsonResponse(text),
      error: response.ok ? undefined : "AgentMail returned HTTP " + response.status,
    };
  } catch (error) {
    return {
      sponsor: "agentmail",
      mode: "real",
      ok: false,
      endpoint,
      requestBody,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildAgentMailConfirmationBody(
  input: AgentMailConfirmationRequest,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const now = input.now || new Date();
  const subject = input.subject || "Dinner confirmed at " + input.restaurantName;
  const text = input.text || [
    "Confirming dinner for " + String(input.partySize) + " at " + input.restaurantName + ".",
    "Time: " + input.bookingTime + ".",
    "Name: " + input.bookingName + ".",
  ].join("\n");
  return {
    schema: "peripheral-agentmail-confirmation-v1",
    to: input.to || env.AGENTMAIL_TO || env.AGENTMAIL_INBOX || "wearer@example.invalid",
    from: input.from || env.AGENTMAIL_FROM || undefined,
    inbox: env.AGENTMAIL_INBOX || undefined,
    subject: cleanText(subject, 120),
    text: cleanText(text, 1000),
    metadata: {
      peripheral_workflow: "dinner-booking",
      session_id: input.sessionId,
      restaurant_name: input.restaurantName,
      booking_time: input.bookingTime,
      party_size: input.partySize,
      booking_name: input.bookingName,
      generated_at: now.toISOString(),
    },
  };
}

function localAgentMailResult(endpoint: string, requestBody: Record<string, unknown>, reviewReason: string): AgentMailSendResult {
  return {
    sponsor: "agentmail",
    mode: "phone_gateway",
    ok: true,
    endpoint,
    requestBody,
    reviewReason,
  };
}

function agentMailSendEndpoint(env: Record<string, string | undefined>): string {
  const base = String(env.AGENTMAIL_API_URL || DEFAULT_AGENTMAIL_API_BASE).replace(/\/+$/, "");
  const path = String(env.AGENTMAIL_SEND_PATH || "/messages").replace(/^([^/])/, "/$1");
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
