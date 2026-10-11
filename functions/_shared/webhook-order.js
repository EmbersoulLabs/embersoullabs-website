/**
 * Apply a signature-verified Stripe event to the website order ledger.
 * The event payload is not the payment authority. The retrieved Checkout Session is.
 * KV is not read and cannot skip this path.
 */
import {
  applyPaymentEvent,
  rememberPaymentIntent,
  validateSessionId,
} from "./order-state.js";

export const SESSION_EVENT_TYPES = Object.freeze([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

export const CHARGE_EVENT_TYPES = Object.freeze([
  "charge.refunded",
  "charge.dispute.created",
]);

function paymentIntentId(value) {
  if (!value) return null;
  if (typeof value.payment_intent === "string") return value.payment_intent;
  if (value.payment_intent && typeof value.payment_intent.id === "string") return value.payment_intent.id;
  return null;
}

export function normalizeRetrievedSession(data) {
  const raw = data && data.line_items;
  const items = Array.isArray(raw) ? raw : raw && Array.isArray(raw.data) ? raw.data : [];
  return { ...data, line_items: items };
}

function httpFor(result, eventType) {
  const duplicate = result.duplicate === true || result.code === "duplicate_event";
  return {
    status: 200,
    body: {
      ok: result.ok !== false || duplicate || result.code === "illegal_transition",
      handled: duplicate ? "idempotent_skip" : eventType,
      code: result.code,
      duplicate,
      side_effects: result.changed ? "order_state" : "none",
      order_creation: "disabled",
      emberos_production: "not_connected",
    },
  };
}

async function applySession(db, event, session, now) {
  const result = await applyPaymentEvent(db, {
    eventId: event.id,
    eventType: event.type,
    session,
    now,
  });
  if (result.ok !== false) {
    await rememberPaymentIntent(db, session.id, paymentIntentId(session));
  }
  return httpFor(result, event.type);
}

export async function applyVerifiedStripeEvent(options) {
  const event = options.event;
  const now = options.now || new Date().toISOString();
  if (!event || !event.id || !event.type) {
    return { status: 400, body: { ok: false, code: "missing_event_id", emberos_production: "not_connected" } };
  }
  const object = event.data && event.data.object;

  if (CHARGE_EVENT_TYPES.includes(event.type)) {
    const intentId = paymentIntentId(object);
    const order = intentId
      ? await options.db.get(
          `SELECT checkout_session_id FROM orders WHERE payment_intent_id = ?`,
          [intentId]
        )
      : null;
    if (!order) {
      return {
        status: 500,
        body: { ok: false, code: "order_not_linked_yet", emberos_production: "not_connected" },
      };
    }
    const retrieved = await options.retrieveSession(order.checkout_session_id);
    if (!retrieved || !retrieved.ok) {
      return { status: 502, body: { ok: false, code: "session_retrieve_failed", emberos_production: "not_connected" } };
    }
    return applySession(options.db, event, normalizeRetrievedSession(retrieved.session), now);
  }

  if (!SESSION_EVENT_TYPES.includes(event.type)) {
    return {
      status: 200,
      body: {
        ok: true,
        handled: "ignored",
        type: event.type,
        order_creation: "disabled",
        emberos_production: "not_connected",
        side_effects: "none",
      },
    };
  }

  const sessionId = object && object.id;
  if (!validateSessionId(sessionId)) {
    return {
      status: 200,
      body: {
        ok: true,
        handled: "ignored",
        code: "ignored_session",
        order_creation: "disabled",
        emberos_production: "not_connected",
        side_effects: "none",
      },
    };
  }
  const retrieved = await options.retrieveSession(sessionId);
  if (!retrieved || !retrieved.ok) {
    return { status: 502, body: { ok: false, code: "session_retrieve_failed", emberos_production: "not_connected" } };
  }
  return applySession(options.db, event, normalizeRetrievedSession(retrieved.session), now);
}
