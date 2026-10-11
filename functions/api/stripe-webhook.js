/**
 * POST /api/stripe-webhook
 *
 * Production: PAYMENT_EVENTS KV + STRIPE_WEBHOOK_SECRET REQUIRED.
 * In-memory idempotency ONLY when ALLOW_IN_MEMORY_IDEMPOTENCY=true in non-production.
 * No EmberOS jobs. No card data stored.
 */
import { d1Adapter } from "../_shared/order-db.js";
import {
  assertPaymentEventsKv,
  assertStripeSecretConfigured,
  assertWebhookSecretConfigured,
  assertWebsiteOrdersDb,
  getRuntimeMode,
} from "../_shared/production-guard.js";
import { jsonResponse, stripeRequest } from "../_shared/stripe.js";
import { applyVerifiedStripeEvent } from "../_shared/webhook-order.js";

/** Dev-only memory store — never used when runtime mode is production. */
const memorySeen = new Map();

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parseSignatureHeader(header) {
  if (!header) return null;
  const parts = {};
  for (const item of header.split(",")) {
    const [k, v] = item.split("=");
    if (!k || v == null) continue;
    const key = k.trim();
    if (key === "v1") {
      if (!parts.v1) parts.v1 = [];
      parts.v1.push(v.trim());
    } else {
      parts[key] = v.trim();
    }
  }
  if (!parts.t || !parts.v1 || !parts.v1.length) return null;
  return parts;
}

async function hmacSha256Hex(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function webhookSecretBytes(webhookSecret) {
  // Stripe signs with the full secret string, including the whsec_ prefix.
  // The prefix is not a Base64 envelope.
  return new TextEncoder().encode(webhookSecret);
}

export async function verifyStripeSignature(payload, header, webhookSecret) {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  const ts = Number(parsed.t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  const signed = `${parsed.t}.${payload}`;
  const keyBytes = webhookSecretBytes(webhookSecret);
  const hex = await hmacSha256Hex(keyBytes, signed);
  return parsed.v1.some((v) => timingSafeEqual(hex, v));
}

async function getProcessed(env, eventId, storeKind) {
  if (!eventId) return null;
  if (storeKind === "kv") {
    const hit = await env.PAYMENT_EVENTS.get(`evt:${eventId}`);
    return hit ? JSON.parse(hit) : null;
  }
  return memorySeen.get(eventId) || null;
}

async function putProcessed(env, eventId, record, storeKind) {
  if (!eventId) {
    throw new Error("missing_event_id");
  }
  if (storeKind === "kv") {
    await env.PAYMENT_EVENTS.put(`evt:${eventId}`, JSON.stringify(record), {
      expirationTtl: 60 * 60 * 24 * 90,
    });
    // Secondary index by session for future order lookups (no PII)
    if (record.checkout_session_id) {
      await env.PAYMENT_EVENTS.put(
        `cs:${record.checkout_session_id}:last_event`,
        eventId,
        { expirationTtl: 60 * 60 * 24 * 90 }
      );
    }
    return;
  }
  memorySeen.set(eventId, record);
}

export async function onRequestPost(context) {
  const env = context.env;
  const mode = getRuntimeMode(env);

  const secretCheck = assertStripeSecretConfigured(env);
  if (!secretCheck.ok) {
    return jsonResponse(
      {
        ok: false,
        received: false,
        error: secretCheck.error,
        code: secretCheck.code,
        order_creation: "disabled",
        emberos_production: "not_connected",
      },
      503
    );
  }

  const webhookCheck = assertWebhookSecretConfigured(env);
  if (!webhookCheck.ok) {
    return jsonResponse(
      {
        ok: false,
        received: false,
        error: webhookCheck.error,
        code: webhookCheck.code,
        status: "fail_closed",
        order_creation: "disabled",
        emberos_production: "not_connected",
      },
      503
    );
  }

  const ordersCheck = assertWebsiteOrdersDb(env);
  if (!ordersCheck.ok) {
    return jsonResponse(
      {
        ok: false,
        received: false,
        error: ordersCheck.error,
        code: ordersCheck.code || "missing_website_orders",
        status: "fail_closed",
        order_creation: "disabled",
        emberos_production: "not_connected",
        marked_processed: false,
      },
      503
    );
  }

  const kvCheck = assertPaymentEventsKv(env, {
    allowInMemoryDev: mode !== "production",
  });

  const payload = await context.request.text();
  const sigHeader = context.request.headers.get("Stripe-Signature");

  const valid = await verifyStripeSignature(
    payload,
    sigHeader,
    env.STRIPE_WEBHOOK_SECRET
  );
  if (!valid) {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid Stripe signature",
        code: "bad_signature",
        marked_processed: false,
      },
      400
    );
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  if (!event.id) {
    return jsonResponse(
      { ok: false, error: "Missing Stripe event.id", code: "missing_event_id" },
      400
    );
  }

  const applied = await applyVerifiedStripeEvent({
    db: d1Adapter(env.WEBSITE_ORDERS),
    event,
    now: new Date().toISOString(),
    retrieveSession: async (sessionId) => {
      const { status, data } = await stripeRequest(
        env.STRIPE_SECRET_KEY,
        "GET",
        `checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`
      );
      if (status >= 400 || !data || data.error || !data.id) return { ok: false };
      return { ok: true, session: data };
    },
  });

  if (applied.status === 200 && kvCheck.ok && event.id) {
    try {
      await putProcessed(
        env,
        event.id,
        {
          stripe_event_id: event.id,
          event_type: event.type,
          code: applied.body && applied.body.code,
          handled: applied.body && applied.body.handled,
          order_creation: "disabled",
          emberos_production: "not_connected",
        },
        kvCheck.store
      );
    } catch {
      // KV is a cache. A cache write failure does not undo the D1 result.
    }
  }

  if (applied.body && applied.body.duplicate) {
    return jsonResponse({
      ok: true,
      duplicate: true,
      event_id: event.id,
      handled: "idempotent_skip",
      code: applied.body.code,
      order_creation: "disabled",
      emberos_production: "not_connected",
      side_effects: "none",
    });
  }

  return jsonResponse(applied.body, applied.status);
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const mode = getRuntimeMode(env);
  const kv = assertPaymentEventsKv(env, { allowInMemoryDev: mode !== "production" });
  const wh = assertWebhookSecretConfigured(env);
  const sk = assertStripeSecretConfigured(env);

  return jsonResponse({
    ok: true,
    endpoint: "/api/stripe-webhook",
    runtime_mode: mode,
    order_creation: "disabled",
    emberos_production: "not_connected",
    webhook_secret_configured: wh.ok,
    stripe_secret_configured: sk.ok,
    payment_events: kv.ok ? kv.store : "missing",
    payment_events_probe: kv.probe || null,
    idempotency_key: "stripe_event_id (event.id)",
    in_memory_production_fallback: false,
    payment_states: {
      CONFIRMED: "paid | no_payment_required | async_payment_succeeded",
      PENDING: "unpaid after checkout.session.completed (async methods)",
      FAILED: "expired | async_payment_failed",
    },
    website_orders: assertWebsiteOrdersDb(env).ok ? "present" : "missing",
    order_authority: "d1",
    required_production_bindings: [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "SITE_ORIGIN",
      "PAYMENT_EVENTS",
      "WEBSITE_ORDERS",
    ],
  });
}
