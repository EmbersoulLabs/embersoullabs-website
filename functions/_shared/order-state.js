/**
 * Website order lifecycle. Pure validation plus D1-compatible SQL.
 * Production checkout and webhook handlers do not import this module yet.
 * EmberOS is not called and cannot be stored on an order.
 */
import {
  getExpectedAmount,
  getLookupKey,
  normalizeRegion,
  normalizeService,
} from "./catalog.js";

export const PACKAGE_VERSION = "ai_ads_v1";
export const EMBEROS_PRODUCTION = "not_connected";

export const ORDER_STATES = Object.freeze([
  "CREATED",
  "PENDING",
  "PAID",
  "READY_FOR_PRODUCTION",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
]);

const PREDECESSORS = Object.freeze({
  PENDING: Object.freeze(["CREATED"]),
  PAID: Object.freeze(["CREATED", "PENDING"]),
  FAILED: Object.freeze(["CREATED", "PENDING"]),
  EXPIRED: Object.freeze(["CREATED", "PENDING"]),
  CANCELLED: Object.freeze(["CREATED", "PENDING"]),
  READY_FOR_PRODUCTION: Object.freeze(["PAID"]),
  REFUNDED: Object.freeze(["PAID", "READY_FOR_PRODUCTION"]),
});

const SESSION_ID = /^cs_live_[A-Za-z0-9]+$/;
const PRICE_ID = /^price_[A-Za-z0-9]+$/;

export function predecessorsFor(state) {
  return PREDECESSORS[state] ? [...PREDECESSORS[state]] : [];
}

export function canTransition(from, to) {
  if (from === to) return true;
  return predecessorsFor(to).includes(from);
}

function fail(code) {
  return { ok: false, code };
}

export function validateSessionId(sessionId) {
  return SESSION_ID.test(sessionId || "");
}

export function validatePriceId(priceId) {
  return PRICE_ID.test(priceId || "");
}

/**
 * Validate a Checkout Session retrieved from Stripe against the stored order
 * and the approved catalog. The browser redirect is not an input.
 */
export function validateRetrievedSession(session, order) {
  if (!session || typeof session !== "object" || !order) return fail("invalid_session");
  if (session.livemode !== true) return fail("not_livemode");
  if (!validateSessionId(session.id)) return fail("invalid_session_id");
  if (session.id !== order.checkout_session_id) return fail("session_mismatch");
  if (session.payment_status === "no_payment_required") return fail("no_payment_required");

  const service = normalizeService(session.metadata && session.metadata.service);
  const region = normalizeRegion(session.metadata && session.metadata.region);
  if (!service || service !== order.service) return fail("invalid_service");
  if (!region || region !== order.region) return fail("invalid_region");

  const lookupKey = session.metadata && session.metadata.lookup_key;
  if (!lookupKey || lookupKey !== order.lookup_key || getLookupKey(service, region) !== lookupKey) {
    return fail("lookup_mismatch");
  }
  if (
    !session.metadata ||
    session.metadata.package_version !== PACKAGE_VERSION ||
    order.package_version !== PACKAGE_VERSION
  ) {
    return fail("wrong_package_version");
  }

  const expected = getExpectedAmount(lookupKey);
  if (!expected) return fail("lookup_mismatch");
  if (session.currency !== expected.currency || session.currency !== order.currency) {
    return fail("wrong_currency");
  }
  if (session.amount_total !== expected.unit_amount || session.amount_total !== order.amount_total) {
    return fail("wrong_amount");
  }

  const items = session.line_items || [];
  const item = items[0];
  if (!item || items.length !== 1 || item.quantity !== 1) return fail("wrong_quantity");
  const price = item.price || {};
  if (!validatePriceId(price.id) || price.id !== order.price_id) return fail("wrong_price");
  if (price.lookup_key !== lookupKey) return fail("lookup_mismatch");
  if (price.livemode !== true || price.active !== true || price.type !== "one_time") {
    return fail("wrong_price");
  }
  if (price.currency !== expected.currency || price.unit_amount !== expected.unit_amount) {
    return fail("wrong_amount");
  }

  return { ok: true, paymentStatus: session.payment_status || null };
}

export function intendedStateForEvent(eventType, paymentStatus) {
  if (eventType === "checkout.session.async_payment_failed") return "FAILED";
  if (eventType === "checkout.session.expired") return "EXPIRED";
  if (eventType === "checkout.session.async_payment_succeeded") {
    return paymentStatus === "paid" ? "PAID" : null;
  }
  if (eventType === "charge.refunded" || eventType === "charge.dispute.created") return "REFUNDED";
  if (eventType === "checkout.session.completed") {
    if (paymentStatus === "paid") return "PAID";
    if (paymentStatus === "unpaid") return "PENDING";
    return null;
  }
  return null;
}

function orderBySession(db, checkoutSessionId) {
  return db
    .prepare(
      `SELECT id, checkout_session_id, state, service, region, lookup_key, price_id,
              currency, amount_total, quantity, package_version, livemode,
              stripe_payment_status, brief_status, emberos_production, apply_count,
              paid_at, ready_at
       FROM orders WHERE checkout_session_id = ?`
    )
    .get(checkoutSessionId);
}

function eventById(db, stripeEventId) {
  return db
    .prepare(
      `SELECT stripe_event_id, checkout_session_id, intended_state, disposition, applied_at
       FROM payment_events WHERE stripe_event_id = ?`
    )
    .get(stripeEventId);
}

function resultFrom(order, extra) {
  return {
    ok: true,
    state: order ? order.state : null,
    applyCount: order ? order.apply_count : 0,
    emberos_production: EMBEROS_PRODUCTION,
    ...extra,
  };
}

function recordRejected(db, input, code, now) {
  try {
    db.prepare(
      `INSERT INTO payment_events (
         stripe_event_id, checkout_session_id, event_type, intended_state,
         stripe_payment_status, failure_reason, disposition, applied_at, created_at
       ) VALUES (?, ?, ?, 'REJECTED', ?, ?, 'rejected', ?, ?)`
    ).run(
      input.eventId,
      input.session.id,
      input.eventType,
      input.session.payment_status || null,
      code,
      now,
      now
    );
  } catch (error) {
    if (!String(error.message).includes("UNIQUE")) throw error;
    return resultFrom(orderBySession(db, input.session.id), {
      duplicate: true,
      code,
      changed: false,
    });
  }
  return resultFrom(orderBySession(db, input.session.id), {
    duplicate: false,
    code,
    changed: false,
  });
}

/**
 * Insert one Stripe event. The unique event id plus the insert trigger apply
 * a legal transition at most once. Callers do not use BEGIN IMMEDIATE.
 */
function insertPendingClaim(db, input, intended, paymentStatus, now) {
  db.prepare(
    `INSERT INTO payment_events (
       stripe_event_id, checkout_session_id, event_type, intended_state,
       stripe_payment_status, failure_reason, disposition, applied_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`
  ).run(
    input.eventId,
    input.session.id,
    input.eventType,
    intended,
    paymentStatus,
    intended === "FAILED" || intended === "EXPIRED" || intended === "CANCELLED" ? intended : null,
    now
  );
}

export function applyPaymentEvent(db, input) {
  const now = input.now || new Date().toISOString();
  const sessionId = input.session && input.session.id;
  const order = orderBySession(db, sessionId);
  if (!order) {
    const catalogOrder = catalogOrderFromSession(input.session);
    if (!catalogOrder) {
      return { ok: false, code: "order_not_found", emberos_production: EMBEROS_PRODUCTION };
    }
    const validation = validateRetrievedSession(input.session, catalogOrder);
    if (!validation.ok) return { ...resultFrom(null), ok: false, code: validation.code, changed: false };
    const intended = intendedStateForEvent(input.eventType, validation.paymentStatus);
    if (!intended) return { ...resultFrom(null), ok: false, code: "unsupported_event", changed: false };
    try {
      insertPendingClaim(db, input, intended, validation.paymentStatus, now);
    } catch (error) {
      if (!String(error.message).includes("UNIQUE")) throw error;
      return resultFrom(null, { duplicate: true, changed: false, code: "duplicate_event" });
    }
    return resultFrom(null, { duplicate: false, changed: false, code: "claimed_for_recovery" });
  }

  const validation = validateRetrievedSession(input.session, {
    ...order,
    livemode: order.livemode === 1,
  });
  if (!validation.ok) {
    const rejected = recordRejected(db, input, validation.code, now);
    return { ...rejected, ok: false };
  }

  const intended = intendedStateForEvent(input.eventType, validation.paymentStatus);
  if (!intended) {
    const rejected = recordRejected(db, input, "unsupported_event", now);
    return { ...rejected, ok: false };
  }

  if (intended === "REFUNDED" && !canTransition(order.state, "REFUNDED")) {
    const rejected = recordRejected(db, input, "refund_not_applicable", now);
    return { ...rejected, ok: false };
  }

  try {
    insertPendingClaim(db, input, intended, validation.paymentStatus, now);
  } catch (error) {
    if (!String(error.message).includes("UNIQUE")) throw error;
    const current = orderBySession(db, input.session.id);
    return resultFrom(current, { duplicate: true, changed: false, code: "duplicate_event" });
  }

  const current = orderBySession(db, input.session.id);
  const event = eventById(db, input.eventId);
  return resultFrom(current, {
    duplicate: false,
    changed: event && event.disposition === "applied",
    code: event && event.disposition === "rejected" ? "illegal_transition" : "applied",
  });
}

/**
 * Finish a claim that was stored before the order row existed.
 * A second call cannot move the order again.
 */
export function recoverUnappliedEvent(db, stripeEventId, now = new Date().toISOString()) {
  const event = db
    .prepare(
      `SELECT stripe_event_id, checkout_session_id, event_type, intended_state,
              stripe_payment_status, failure_reason, disposition
       FROM payment_events WHERE stripe_event_id = ?`
    )
    .get(stripeEventId);
  if (!event) return { ok: false, code: "event_not_found", emberos_production: EMBEROS_PRODUCTION };
  if (event.disposition !== "pending") {
    const order = orderBySession(db, event.checkout_session_id);
    return resultFrom(order, { duplicate: true, changed: false, code: "already_closed" });
  }

  db.prepare(
    `UPDATE orders
     SET state = ?,
         stripe_payment_status = COALESCE(?, stripe_payment_status),
         failure_reason = COALESCE(?, failure_reason),
         updated_at = ?,
         paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, ?) ELSE paid_at END,
         apply_count = apply_count + 1
     WHERE checkout_session_id = ?
       AND (
         (? = 'PENDING' AND state = 'CREATED')
         OR (? = 'PAID' AND state IN ('CREATED', 'PENDING'))
         OR (? = 'FAILED' AND state IN ('CREATED', 'PENDING'))
         OR (? = 'EXPIRED' AND state IN ('CREATED', 'PENDING'))
         OR (? = 'CANCELLED' AND state IN ('CREATED', 'PENDING'))
         OR (? = 'REFUNDED' AND state IN ('PAID', 'READY_FOR_PRODUCTION'))
       )`
  ).run(
    event.intended_state,
    event.stripe_payment_status,
    event.failure_reason,
    now,
    event.intended_state,
    now,
    event.checkout_session_id,
    event.intended_state,
    event.intended_state,
    event.intended_state,
    event.intended_state,
    event.intended_state,
    event.intended_state
  );

  const order = orderBySession(db, event.checkout_session_id);
  if (order && order.state === event.intended_state) {
    db.prepare(
      `UPDATE payment_events
       SET disposition = 'applied', applied_at = ?
       WHERE stripe_event_id = ? AND disposition = 'pending'`
    ).run(now, stripeEventId);
    return resultFrom(orderBySession(db, event.checkout_session_id), {
      duplicate: false,
      changed: true,
      code: "recovered",
    });
  }

  if (order) {
    db.prepare(
      `UPDATE payment_events
       SET disposition = 'rejected', applied_at = ?
       WHERE stripe_event_id = ? AND disposition = 'pending'`
    ).run(now, stripeEventId);
  }
  return resultFrom(order, { duplicate: false, changed: false, code: "not_recovered" });
}

export function createOrder(db, input) {
  const now = input.now || new Date().toISOString();
  db.prepare(
    `INSERT INTO orders (
       id, checkout_session_id, payment_intent_id, state, service, region, lookup_key,
       price_id, currency, amount_total, quantity, package_version, livemode,
       stripe_payment_status, brief_status, failure_reason, emberos_production,
       apply_count, created_at, updated_at
     ) VALUES (?, ?, ?, 'CREATED', ?, ?, ?, ?, ?, ?, 1, ?, 1, 'unpaid', 'missing', NULL, 'not_connected', 0, ?, ?)`
  ).run(
    input.id,
    input.checkoutSessionId,
    input.paymentIntentId || null,
    input.service,
    input.region,
    input.lookupKey,
    input.priceId,
    input.currency,
    input.amountTotal,
    input.packageVersion || PACKAGE_VERSION,
    now,
    now
  );
  return orderBySession(db, input.checkoutSessionId);
}

export function completeCreativeBrief(db, input) {
  const now = input.now || new Date().toISOString();
  db.prepare(
    `INSERT INTO creative_briefs (
       id, order_id, promotion_text, asset_status, language, contact, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.orderId,
    input.promotionText,
    input.assetStatus,
    input.language,
    input.contact,
    now
  );
  return db.prepare("SELECT state, brief_status, emberos_production, ready_at FROM orders WHERE id = ?").get(input.orderId);
}

function catalogOrderFromSession(session) {
  if (!session || !session.metadata) return null;
  const service = normalizeService(session.metadata.service);
  const region = normalizeRegion(session.metadata.region);
  const lookupKey = getLookupKey(service, region);
  const expected = lookupKey ? getExpectedAmount(lookupKey) : null;
  const price = session.line_items && session.line_items[0] && session.line_items[0].price;
  if (!service || !region || !lookupKey || !expected || !price) return null;
  return {
    checkout_session_id: session.id,
    service,
    region,
    lookup_key: lookupKey,
    package_version: PACKAGE_VERSION,
    currency: expected.currency,
    amount_total: expected.unit_amount,
    price_id: price.id,
  };
}
