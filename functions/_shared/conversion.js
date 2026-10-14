/**
 * Purchase and inquiry measurement phases.
 * reserve: short-lived permission to send one hit
 * attempt: the browser invoked the tag
 * acknowledge: the tag reported event_callback
 * Acknowledgement is the dedupe lock. A failed send leaves acknowledgement empty
 * so a later visit can reserve the same transaction_id again.
 * Webhooks never call this module. Historical orders are not made eligible here.
 */
import { readAuthorizedOrder } from "./order-access.js";
import { purchaseValue, sanitizeAttribution } from "./attribution.js";

const PAID_STATES = new Set(["PAID", "READY_FOR_PRODUCTION"]);
const RESERVE_MS = 120 * 1000;
const PHASES = new Set(["reserve", "attempt", "acknowledge"]);

function stampOf(now) {
  return now || new Date().toISOString();
}

function staleCutoff(stamp) {
  return new Date(Date.parse(stamp) - RESERVE_MS).toISOString();
}

export async function rememberAttribution(db, orderId, attribution, now) {
  if (!orderId) return { stored: false };
  const clean = sanitizeAttribution(attribution);
  const stamp = stampOf(now);
  await db.run(
    `INSERT INTO order_attribution (
       order_id, gclid, gbraid, wbraid, stored_at, measurement_eligible_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(order_id) DO UPDATE SET
       measurement_eligible_at = COALESCE(order_attribution.measurement_eligible_at, excluded.measurement_eligible_at),
       gclid = COALESCE(order_attribution.gclid, excluded.gclid),
       gbraid = COALESCE(order_attribution.gbraid, excluded.gbraid),
       wbraid = COALESCE(order_attribution.wbraid, excluded.wbraid)`,
    [orderId, clean.gclid, clean.gbraid, clean.wbraid, stamp, stamp]
  );
  return { stored: true };
}

function purchaseSnapshot(order, priced, clicks, extra) {
  return {
    ok: true,
    emit: false,
    transaction_id: order.id,
    value: priced.value,
    currency: priced.currency,
    gclid: clicks && clicks.gclid ? clicks.gclid : null,
    gbraid: clicks && clicks.gbraid ? clicks.gbraid : null,
    wbraid: clicks && clicks.wbraid ? clicks.wbraid : null,
    ...extra,
  };
}

export async function progressPurchaseConversion(db, sessionId, accessToken, phase, now) {
  const step = PHASES.has(phase) ? phase : "";
  if (!step) return { status: 400, body: { ok: false, emit: false, code: "invalid_phase" } };
  const auth = await readAuthorizedOrder(db, sessionId, accessToken);
  if (auth.status !== 200) return { status: auth.status, body: { ok: false, emit: false, code: "not_found" } };
  if (!PAID_STATES.has(auth.body.state) || auth.body.confirmed !== true) {
    return { status: 200, body: { ok: true, emit: false, phase: "reserve", reason: "not_paid" } };
  }
  const priced = purchaseValue(auth.order.amount_total, auth.order.currency);
  if (!priced) return { status: 200, body: { ok: true, emit: false, phase: step, reason: "no_value" } };

  const stamp = stampOf(now);
  const current = await db.get(
    `SELECT measurement_eligible_at, purchase_reserved_at, purchase_attempted_at,
            purchase_acknowledged_at, gclid, gbraid, wbraid
     FROM order_attribution WHERE order_id = ?`,
    [auth.order.id]
  );
  if (!current || !current.measurement_eligible_at) {
    return { status: 200, body: { ok: true, emit: false, phase: step, reason: "not_eligible" } };
  }
  if (current.purchase_acknowledged_at) {
    return {
      status: 200,
      body: purchaseSnapshot(auth.order, priced, current, { phase: "acknowledged", reason: "acknowledged" }),
    };
  }

  if (step === "attempt") {
    const attempted = await db.run(
      `UPDATE order_attribution
       SET purchase_attempted_at = COALESCE(purchase_attempted_at, ?)
       WHERE order_id = ? AND measurement_eligible_at IS NOT NULL
         AND purchase_acknowledged_at IS NULL AND purchase_reserved_at IS NOT NULL`,
      [stamp, auth.order.id]
    );
    if (!attempted.changes && !current.purchase_attempted_at) {
      return { status: 200, body: purchaseSnapshot(auth.order, priced, current, { phase: "attempt", reason: "not_reserved" }) };
    }
    return { status: 200, body: purchaseSnapshot(auth.order, priced, current, { phase: "attempted", reason: "attempted" }) };
  }

  if (step === "acknowledge") {
    const acknowledged = await db.run(
      `UPDATE order_attribution
       SET purchase_acknowledged_at = ?
       WHERE order_id = ? AND measurement_eligible_at IS NOT NULL
         AND purchase_acknowledged_at IS NULL AND purchase_reserved_at IS NOT NULL`,
      [stamp, auth.order.id]
    );
    if (!acknowledged.changes) {
      return { status: 200, body: purchaseSnapshot(auth.order, priced, current, { phase: "acknowledge", reason: "not_reserved" }) };
    }
    return { status: 200, body: purchaseSnapshot(auth.order, priced, current, { phase: "acknowledged", reason: "acknowledged" }) };
  }

  const reserved = await db.run(
    `UPDATE order_attribution
     SET purchase_reserved_at = ?
     WHERE order_id = ? AND measurement_eligible_at IS NOT NULL
       AND purchase_acknowledged_at IS NULL
       AND (purchase_reserved_at IS NULL OR purchase_reserved_at < ?)`,
    [stamp, auth.order.id, staleCutoff(stamp)]
  );
  if (!reserved.changes) {
    return { status: 200, body: purchaseSnapshot(auth.order, priced, current, { phase: "reserved", reason: "reserved" }) };
  }
  return {
    status: 200,
    body: purchaseSnapshot(auth.order, priced, current, { emit: true, phase: "reserved", reason: "reserved" }),
  };
}

export async function progressInquiryConversion(db, inquiryId, phase, now) {
  const step = PHASES.has(phase) ? phase : "";
  if (!step) return { status: 400, body: { ok: false, emit: false, code: "invalid_phase" } };
  if (typeof inquiryId !== "string" || !/^inq_[A-Za-z0-9_-]{8,80}$/.test(inquiryId)) {
    return { status: 404, body: { ok: false, emit: false, code: "not_found" } };
  }
  const stamp = stampOf(now);
  const current = await db.get(
    `SELECT conversion_reserved_at, conversion_attempted_at, conversion_acknowledged_at
     FROM inquiries WHERE id = ?`,
    [inquiryId]
  );
  if (!current) return { status: 404, body: { ok: false, emit: false, code: "not_found" } };
  if (current.conversion_acknowledged_at) {
    return { status: 200, body: { ok: true, emit: false, phase: "acknowledged", reason: "acknowledged", transaction_id: inquiryId } };
  }
  if (step === "attempt") {
    const attempted = await db.run(
      `UPDATE inquiries
       SET conversion_attempted_at = COALESCE(conversion_attempted_at, ?)
       WHERE id = ? AND conversion_acknowledged_at IS NULL AND conversion_reserved_at IS NOT NULL`,
      [stamp, inquiryId]
    );
    if (!attempted.changes && !current.conversion_attempted_at) {
      return { status: 200, body: { ok: true, emit: false, phase: "attempt", reason: "not_reserved", transaction_id: inquiryId } };
    }
    return { status: 200, body: { ok: true, emit: false, phase: "attempted", reason: "attempted", transaction_id: inquiryId } };
  }
  if (step === "acknowledge") {
    const acknowledged = await db.run(
      `UPDATE inquiries
       SET conversion_acknowledged_at = ?
       WHERE id = ? AND conversion_acknowledged_at IS NULL AND conversion_reserved_at IS NOT NULL`,
      [stamp, inquiryId]
    );
    if (!acknowledged.changes) {
      return { status: 200, body: { ok: true, emit: false, phase: "acknowledge", reason: "not_reserved", transaction_id: inquiryId } };
    }
    return { status: 200, body: { ok: true, emit: false, phase: "acknowledged", reason: "acknowledged", transaction_id: inquiryId } };
  }
  const reserved = await db.run(
    `UPDATE inquiries
     SET conversion_reserved_at = ?
     WHERE id = ? AND conversion_acknowledged_at IS NULL
       AND (conversion_reserved_at IS NULL OR conversion_reserved_at < ?)`,
    [stamp, inquiryId, staleCutoff(stamp)]
  );
  if (!reserved.changes) {
    return { status: 200, body: { ok: true, emit: false, phase: "reserved", reason: "reserved", transaction_id: inquiryId } };
  }
  return { status: 200, body: { ok: true, emit: true, phase: "reserved", reason: "reserved", transaction_id: inquiryId } };
}
