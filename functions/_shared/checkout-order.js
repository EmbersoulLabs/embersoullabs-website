/**
 * Create a website order before returning a Checkout URL.
 * A persist failure returns a recovery handle and no URL.
 * Nothing here marks an order paid.
 */
import { SERVICE_LABELS, getPackageFacts } from "./catalog.js";
import { PACKAGE_VERSION, createOrder, recoverUnappliedEvent } from "./order-state.js";
import { randomToken, sha256Hex, timingSafeEqual } from "./order-access.js";
import { stripeRequest as defaultStripeRequest } from "./stripe.js";

function bytesToBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToString(value) {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomId(prefix) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return prefix + hex;
}

export function checkoutForm(input) {
  const successUrl =
    `${input.origin}/ai-ads/checkout/success/?session_id={CHECKOUT_SESSION_ID}` +
    `&access_token=${encodeURIComponent(input.accessToken)}`;
  const cancelUrl =
    `${input.origin}/ai-ads/checkout/cancel/?service=${encodeURIComponent(input.service)}` +
    `&region=${encodeURIComponent(input.region)}`;
  const form = {
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": "1",
    "metadata[service]": input.service,
    "metadata[region]": input.region,
    "metadata[lookup_key]": input.lookupKey,
    "metadata[package_version]": PACKAGE_VERSION,
    "metadata[product_label]": SERVICE_LABELS[input.service],
    "metadata[source]": "embersoul_ai_ads_website",
    "metadata[website_order_id]": input.orderId,
    "payment_intent_data[metadata][service]": input.service,
    "payment_intent_data[metadata][region]": input.region,
    "payment_intent_data[metadata][lookup_key]": input.lookupKey,
    "payment_intent_data[metadata][package_version]": PACKAGE_VERSION,
    "payment_intent_data[metadata][website_order_id]": input.orderId,
  };
  const facts = input.facts || getPackageFacts(input.service);
  if (facts) {
    form["metadata[duration]"] = facts.duration;
    form["metadata[episodes]"] = facts.episodes;
    form["metadata[continuity]"] = facts.continuity;
    form["metadata[deliverable]"] = facts.deliverable;
  }
  return form;
}

async function signRecovery(secret, payload) {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacHex(secret, body);
  return `${body}.${sig}`;
}

async function readRecovery(secret, handle) {
  if (typeof handle !== "string" || !handle.includes(".")) return null;
  const dot = handle.lastIndexOf(".");
  const body = handle.slice(0, dot);
  const sig = handle.slice(dot + 1);
  const expected = await hmacHex(secret, body);
  if (!timingSafeEqual(expected, sig)) return null;
  let payload;
  try {
    payload = JSON.parse(base64UrlToString(body));
  } catch {
    return null;
  }
  if (!payload || payload.v !== 1 || typeof payload.exp !== "number") return null;
  if (payload.exp < Date.now()) return null;
  return payload;
}

function publicCheckout(data, draft) {
  return {
    ok: true,
    url: data.url,
    sessionId: data.id,
    service: draft.service,
    region: draft.region,
    lookupKey: draft.lookupKey,
    state: "CREATED",
    emberos_production: "not_connected",
  };
}

async function recoverPending(db, sessionId, now) {
  let previous = "";
  for (let i = 0; i < 5; i++) {
    const row = await db.get(
      `SELECT stripe_event_id FROM payment_events
       WHERE checkout_session_id = ? AND disposition = 'pending' LIMIT 1`,
      [sessionId]
    );
    if (!row || row.stripe_event_id === previous) return;
    previous = row.stripe_event_id;
    await recoverUnappliedEvent(db, row.stripe_event_id, now);
  }
}

async function storeCreatedOrder(db, draft, session, now) {
  const hash = await sha256Hex(draft.accessToken);
  try {
    await createOrder(db, {
      id: draft.orderId,
      checkoutSessionId: session.id,
      accessTokenHash: hash,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      service: draft.service,
      region: draft.region,
      lookupKey: draft.lookupKey,
      priceId: draft.priceId,
      currency: draft.currency,
      amountTotal: draft.amountTotal,
      now,
    });
  } catch (error) {
    if (!String(error && error.message).includes("UNIQUE")) throw error;
    const existing = await db.get(
      `SELECT id, access_token_hash, state FROM orders WHERE checkout_session_id = ?`,
      [session.id]
    );
    if (!existing || existing.access_token_hash !== hash) {
      return { ok: false, code: "order_conflict" };
    }
    return { ok: true, existing: true };
  }
  await recoverPending(db, session.id, now);
  return { ok: true, existing: false };
}

export async function persistCheckoutSession(options) {
  const now = options.now || new Date().toISOString();
  const request = options.stripeRequest || defaultStripeRequest;
  const secret = options.env && options.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return { status: 503, body: { ok: false, code: "missing_webhook_secret", emberos_production: "not_connected" } };
  }
  const draft = {
    orderId: options.orderId || randomId("ord_"),
    accessToken: options.accessToken || randomToken(),
    service: options.service,
    region: options.region,
    lookupKey: options.lookupKey,
    facts: getPackageFacts(options.service),
    priceId: options.price.id,
    currency: options.price.currency,
    amountTotal: options.price.unit_amount,
  };
  const form = checkoutForm({ ...draft, origin: options.origin });
  const idempotencyKey = `website_order_${draft.orderId}`;
  const created = await request(
    options.env.STRIPE_SECRET_KEY,
    "POST",
    "checkout/sessions",
    form,
    { idempotencyKey }
  );
  if (!created.data || created.data.error || !created.data.url || !created.data.id) {
    return {
      status: created.status >= 400 ? created.status : 502,
      body: {
        ok: false,
        error: (created.data && created.data.error && created.data.error.message) || "Failed to create Checkout Session",
        code: "session_create_failed",
        emberos_production: "not_connected",
      },
    };
  }
  let stored;
  try {
    stored = await storeCreatedOrder(options.db, draft, created.data, now);
  } catch {
    stored = { ok: false, code: "order_persist_failed" };
  }
  if (!stored.ok) {
    const recovery_handle = await signRecovery(secret, {
      v: 1,
      orderId: draft.orderId,
      accessToken: draft.accessToken,
      service: draft.service,
      region: draft.region,
      lookupKey: draft.lookupKey,
      priceId: draft.priceId,
      currency: draft.currency,
      amountTotal: draft.amountTotal,
      origin: options.origin,
      exp: Date.now() + 15 * 60 * 1000,
    });
    return {
      status: 503,
      body: {
        ok: false,
        code: stored.code || "order_persist_failed",
        recovery_handle,
        emberos_production: "not_connected",
      },
    };
  }
  return { status: 200, body: publicCheckout(created.data, draft) };
}

export async function recoverWebsiteCheckout(options) {
  const now = options.now || new Date().toISOString();
  const request = options.stripeRequest || defaultStripeRequest;
  const secret = options.env && options.env.STRIPE_WEBHOOK_SECRET;
  const draft = await readRecovery(secret, options.handle);
  if (!draft) {
    return { status: 400, body: { ok: false, code: "invalid_recovery_handle", emberos_production: "not_connected" } };
  }
  const form = checkoutForm(draft);
  const created = await request(
    options.env.STRIPE_SECRET_KEY,
    "POST",
    "checkout/sessions",
    form,
    { idempotencyKey: `website_order_${draft.orderId}` }
  );
  if (!created.data || created.data.error || !created.data.url || !created.data.id) {
    return {
      status: created.status >= 400 ? created.status : 502,
      body: { ok: false, code: "session_create_failed", emberos_production: "not_connected" },
    };
  }
  const stored = await storeCreatedOrder(options.db, draft, created.data, now);
  if (!stored.ok) {
    return { status: 503, body: { ok: false, code: stored.code, emberos_production: "not_connected" } };
  }
  const order = await options.db.get(
    `SELECT state FROM orders WHERE checkout_session_id = ?`,
    [created.data.id]
  );
  if (!order || order.state === "CREATED") {
    return { status: 200, body: publicCheckout(created.data, draft) };
  }
  return {
    status: 200,
    body: {
      ...publicCheckout(created.data, draft),
      state: order.state,
    },
  };
}
