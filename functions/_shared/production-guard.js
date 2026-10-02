/**
 * Production payment readiness guard.
 *
 * Required production bindings:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   SITE_ORIGIN (= https://embersoullabs.com)
 *   PAYMENT_EVENTS (KV)
 *
 * In-memory idempotency is NEVER used in production.
 * Local/dev may opt in with ALLOW_IN_MEMORY_IDEMPOTENCY=true.
 */

export const PRODUCTION_SITE_ORIGIN = "https://embersoullabs.com";

export const REQUIRED_PRODUCTION_BINDINGS = Object.freeze([
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SITE_ORIGIN",
  "PAYMENT_EVENTS",
]);

/**
 * Runtime mode:
 * - production: ENVIRONMENT=production | NODE_ENV=production | APP_ENV=production
 * - development: everything else (local wrangler / preview without prod flag)
 */
export function getRuntimeMode(env) {
  const raw = String(
    (env && (env.ENVIRONMENT || env.APP_ENV || env.NODE_ENV)) || ""
  )
    .toLowerCase()
    .trim();
  if (raw === "production" || raw === "prod") return "production";
  // If SITE_ORIGIN is the real production host and not flagged as local, treat as production.
  const origin = normalizeOrigin(env && env.SITE_ORIGIN);
  if (origin === PRODUCTION_SITE_ORIGIN && raw !== "development" && raw !== "dev") {
    return "production";
  }
  return "development";
}

export function normalizeOrigin(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // Strip trailing slash
    return u.origin;
  } catch {
    return null;
  }
}

export function assertStripeSecretConfigured(env) {
  const secret = env && env.STRIPE_SECRET_KEY;
  if (!secret || typeof secret !== "string") {
    return { ok: false, code: "missing_stripe_secret", error: "STRIPE_SECRET_KEY is not configured" };
  }
  if (
    !(
      secret.startsWith("sk_live_") ||
      secret.startsWith("rk_live_") ||
      secret.startsWith("sk_test_") ||
      secret.startsWith("rk_test_")
    )
  ) {
    return {
      ok: false,
      code: "invalid_stripe_secret",
      error: "STRIPE_SECRET_KEY must be a Stripe secret/restricted key",
    };
  }
  return {
    ok: true,
    mode: secret.includes("_live_") ? "live" : "test",
  };
}

export function assertWebhookSecretConfigured(env) {
  const secret = env && env.STRIPE_WEBHOOK_SECRET;
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    return {
      ok: false,
      code: "missing_webhook_secret",
      error: "STRIPE_WEBHOOK_SECRET is not configured",
    };
  }
  return { ok: true };
}

export function assertPaymentEventsKv(env, { allowInMemoryDev = false } = {}) {
  const mode = getRuntimeMode(env);
  const binding = env ? env.PAYMENT_EVENTS : undefined;
  const hasGet = !!(binding && typeof binding.get === "function");
  const hasPut = !!(binding && typeof binding.put === "function");

  // Cloudflare KV namespace is an object with get/put — never a plain env string.
  if (hasGet && hasPut) {
    return { ok: true, store: "kv", probe: describePaymentEventsBinding(binding) };
  }

  const probe = describePaymentEventsBinding(binding);
  if (mode === "production") {
    return {
      ok: false,
      code: "missing_payment_events_kv",
      error:
        probe.present && probe.type === "string"
          ? "PAYMENT_EVENTS is a string env var, not a KV namespace binding. Remove any plain Environment Variable named PAYMENT_EVENTS so the KV binding can attach."
          : "PAYMENT_EVENTS KV binding is required in production. In-memory fallback is forbidden.",
      probe,
    };
  }
  if (allowInMemoryDev && env && env.ALLOW_IN_MEMORY_IDEMPOTENCY === "true") {
    return { ok: true, store: "memory_dev_only", probe };
  }
  return {
    ok: false,
    code: "missing_payment_events_kv",
    error:
      "PAYMENT_EVENTS KV is required. For local testing only, set ALLOW_IN_MEMORY_IDEMPOTENCY=true.",
    probe,
  };
}

/** Safe probe — never includes values/secrets/KV contents. */
export function describePaymentEventsBinding(binding) {
  const present = binding !== undefined && binding !== null;
  const type = present ? typeof binding : "undefined";
  return {
    present,
    type,
    has_get: !!(binding && typeof binding.get === "function"),
    has_put: !!(binding && typeof binding.put === "function"),
    has_delete: !!(binding && typeof binding.delete === "function"),
    looks_like_kv:
      !!(binding && typeof binding.get === "function" && typeof binding.put === "function"),
  };
}

/**
 * Resolve SITE_ORIGIN for Checkout success/cancel URLs.
 * Production: must be exactly https://embersoullabs.com — never Host header.
 * Development: SITE_ORIGIN if set; optional localhost only when ALLOW_DEV_HOST_ORIGIN=true.
 */
export function resolveSiteOrigin(env, requestUrl) {
  const mode = getRuntimeMode(env);
  const configured = normalizeOrigin(env && env.SITE_ORIGIN);

  if (mode === "production") {
    if (configured !== PRODUCTION_SITE_ORIGIN) {
      return {
        ok: false,
        code: "invalid_site_origin",
        error: `SITE_ORIGIN must be ${PRODUCTION_SITE_ORIGIN} in production`,
      };
    }
    return { ok: true, origin: PRODUCTION_SITE_ORIGIN };
  }

  if (configured) {
    return { ok: true, origin: configured };
  }

  if (env && env.ALLOW_DEV_HOST_ORIGIN === "true" && requestUrl) {
    try {
      const origin = new URL(requestUrl).origin;
      if (
        origin.startsWith("http://127.0.0.1") ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("https://127.0.0.1") ||
        origin.startsWith("https://localhost")
      ) {
        return { ok: true, origin };
      }
    } catch {
      /* ignore */
    }
  }

  return {
    ok: false,
    code: "missing_site_origin",
    error: "SITE_ORIGIN is not configured",
  };
}

/**
 * Full production Checkout readiness.
 * Fail closed if any required binding is missing / invalid.
 */
export function assertProductionCheckoutReady(env) {
  const mode = getRuntimeMode(env);
  const missing = [];

  const secret = assertStripeSecretConfigured(env);
  if (!secret.ok) missing.push("STRIPE_SECRET_KEY");

  const webhook = assertWebhookSecretConfigured(env);
  if (!webhook.ok) missing.push("STRIPE_WEBHOOK_SECRET");

  const origin = resolveSiteOrigin(env, null);
  if (!origin.ok) missing.push("SITE_ORIGIN");

  const kv = assertPaymentEventsKv(env, { allowInMemoryDev: false });
  if (!kv.ok) missing.push("PAYMENT_EVENTS");

  if (mode === "production") {
    if (missing.length) {
      return {
        ok: false,
        mode,
        code: "production_bindings_incomplete",
        error: "Production Checkout unavailable — required bindings missing",
        missing,
        emberos_production: "not_connected",
      };
    }
    return {
      ok: true,
      mode,
      stripeMode: secret.mode,
      siteOrigin: origin.origin,
      emberos_production: "not_connected",
    };
  }

  // Development: require at least Stripe secret + resolvable origin for Checkout Session create.
  // Webhook/KV still fail closed on their own endpoints unless explicitly opted into memory.
  if (!secret.ok) {
    return {
      ok: false,
      mode,
      code: secret.code,
      error: secret.error,
      missing: ["STRIPE_SECRET_KEY"],
    };
  }
  if (!origin.ok) {
    return {
      ok: false,
      mode,
      code: origin.code,
      error: origin.error,
      missing: ["SITE_ORIGIN"],
    };
  }

  return {
    ok: true,
    mode,
    stripeMode: secret.mode,
    siteOrigin: origin.origin,
    production_complete: missing.length === 0,
    missing_for_production: missing,
    emberos_production: "not_connected",
  };
}

/**
 * Classify Stripe Checkout Session payment into CONFIRMED | PENDING | FAILED.
 *
 * CONFIRMED:
 *   payment_status = paid | no_payment_required
 * PENDING:
 *   session complete/open but payment_status unpaid (async methods)
 *   or session status open
 * FAILED:
 *   session expired, or async_payment_failed, or unpaid after failure signals
 */
export function classifyPaymentState(session, eventType) {
  if (eventType === "checkout.session.async_payment_failed") {
    return {
      state: "FAILED",
      orderEligible: false,
      reason: "async_payment_failed",
    };
  }
  if (eventType === "checkout.session.expired") {
    return {
      state: "FAILED",
      orderEligible: false,
      reason: "session_expired",
    };
  }
  if (eventType === "checkout.session.async_payment_succeeded") {
    return {
      state: "CONFIRMED",
      orderEligible: true,
      reason: "async_payment_succeeded",
    };
  }

  if (!session) {
    return { state: "FAILED", orderEligible: false, reason: "missing_session" };
  }

  const paymentStatus = session.payment_status;
  const status = session.status;

  if (paymentStatus === "paid" || paymentStatus === "no_payment_required") {
    return {
      state: "CONFIRMED",
      orderEligible: true,
      reason: paymentStatus,
    };
  }

  if (status === "expired") {
    return { state: "FAILED", orderEligible: false, reason: "session_expired" };
  }

  if (paymentStatus === "unpaid") {
    // checkout.session.completed can fire before async methods settle.
    return {
      state: "PENDING",
      orderEligible: false,
      reason: "awaiting_async_or_settlement",
    };
  }

  return {
    state: "PENDING",
    orderEligible: false,
    reason: "unknown_pending",
  };
}

/**
 * Build durable payment identity record for KV (no card data).
 * Commercial fields come from Stripe session + server mapping metadata only.
 */
export function buildPaymentRecord({ event, session, classification }) {
  const meta = (session && session.metadata) || {};
  return {
    stripe_event_id: event && event.id ? event.id : null,
    checkout_session_id: session && session.id ? session.id : null,
    payment_intent_id:
      session && typeof session.payment_intent === "string"
        ? session.payment_intent
        : session && session.payment_intent && session.payment_intent.id
          ? session.payment_intent.id
          : null,
    service: meta.service || null,
    region: meta.region || null,
    lookup_key: meta.lookup_key || null,
    package_version: meta.package_version || null,
    currency: session && session.currency ? session.currency : null,
    amount_total:
      session && typeof session.amount_total === "number"
        ? session.amount_total
        : null,
    payment_status: session && session.payment_status ? session.payment_status : null,
    session_status: session && session.status ? session.status : null,
    payment_state: classification.state,
    order_eligible: classification.orderEligible,
    created_at: new Date().toISOString(),
    order_creation: "deferred",
    emberos_production: "not_connected",
  };
}
