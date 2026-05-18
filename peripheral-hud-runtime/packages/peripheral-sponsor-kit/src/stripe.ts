import { cleanText } from "../../peripheral-protocol/src/index.js";

const DEFAULT_STRIPE_API_BASE = "https://api.stripe.com/v1";

export type StripePaymentIntentRequest = {
  sessionId: string;
  amountCents: number;
  currency?: string;
  description?: string;
  captureMethod?: "manual" | "automatic";
  customer?: string;
  paymentMethod?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
  idempotencyKey?: string;
  now?: Date;
};

export type StripeAdapterOptions = {
  forceReal?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

export type StripePaymentIntentResult = {
  sponsor: "stripe";
  mode: "phone_gateway" | "real";
  ok: boolean;
  endpoint: string;
  requestBody: Record<string, unknown>;
  status?: number;
  responseBody?: unknown;
  reviewReason?: string;
  error?: string;
};

export async function createStripePaymentIntent(
  input: StripePaymentIntentRequest,
  options: StripeAdapterOptions = {},
): Promise<StripePaymentIntentResult> {
  const env = options.env || process.env;
  const endpoint = stripePaymentIntentEndpoint(env);
  const requestBody = buildStripePaymentIntentBody(input, env);
  if (!options.forceReal) {
    return localStripeResult(endpoint, requestBody, "phone gateway broker route");
  }
  const apiKey = env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    return localStripeResult(endpoint, requestBody, "Stripe credential is externalized through the phone gateway");
  }
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer " + apiKey,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "idempotency-key": input.idempotencyKey || stripeIdempotencyKey(input),
        "x-peripheral-session": input.sessionId,
      },
      body: stripeFormBody(requestBody),
    });
    const text = await response.text();
    return {
      sponsor: "stripe",
      mode: "real",
      ok: response.ok,
      endpoint,
      requestBody,
      status: response.status,
      responseBody: parseJsonResponse(text),
      error: response.ok ? undefined : "Stripe returned HTTP " + response.status,
    };
  } catch (error) {
    return {
      sponsor: "stripe",
      mode: "real",
      ok: false,
      endpoint,
      requestBody,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildStripePaymentIntentBody(
  input: StripePaymentIntentRequest,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const now = input.now || new Date();
  const amount = positiveAmountCents(input.amountCents);
  const currency = cleanText((input.currency || env.STRIPE_CURRENCY || "usd").toLowerCase(), 8);
  const captureMethod = input.captureMethod || "manual";
  return {
    amount,
    currency,
    capture_method: captureMethod,
    confirm: false,
    customer: input.customer || env.STRIPE_CUSTOMER_ID || undefined,
    payment_method: input.paymentMethod || undefined,
    description: cleanText(input.description || "Peripheral approval-gated card hold", 180),
    metadata: stripUndefined({
      peripheral_schema: "peripheral-stripe-payment-intent-v1",
      peripheral_workflow: "approval-gated-card-hold",
      session_id: input.sessionId,
      approval_surface: "glasses",
      generated_at: now.toISOString(),
      ...input.metadata,
    }),
  };
}

function localStripeResult(endpoint: string, requestBody: Record<string, unknown>, reviewReason: string): StripePaymentIntentResult {
  return {
    sponsor: "stripe",
    mode: "phone_gateway",
    ok: true,
    endpoint,
    requestBody,
    reviewReason,
  };
}

function stripePaymentIntentEndpoint(env: Record<string, string | undefined>): string {
  const base = String(env.STRIPE_API_URL || DEFAULT_STRIPE_API_BASE).replace(/\/+$/, "");
  const path = String(env.STRIPE_PAYMENT_INTENT_PATH || "/payment_intents").replace(/^([^/])/, "/$1");
  return base + path;
}

function stripeFormBody(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    appendStripeParam(params, key, value);
  }
  return params;
}

function appendStripeParam(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendStripeParam(params, key + "[" + childKey + "]", childValue);
    }
    return;
  }
  params.append(key, String(value));
}

function positiveAmountCents(value: number): number {
  const amount = Math.round(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Stripe amountCents must be a positive integer.");
  }
  return amount;
}

function stripeIdempotencyKey(input: StripePaymentIntentRequest): string {
  return ["peripheral", input.sessionId, String(positiveAmountCents(input.amountCents)), input.currency || "usd"].join("-");
}

function stripUndefined(input: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Record<string, string | number | boolean>;
}

function parseJsonResponse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 500) };
  }
}
