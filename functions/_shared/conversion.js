/**
 * Purchase and inquiry conversion claims.
 * A claim is the durable dedupe lock. Webhooks never call this module.
 */
import { readAuthorizedOrder } from "./order-access.js";
import { hasAttribution, purchaseValue, sanitizeAttribution } from "./attribution.js";

const PAID_STATES = new Set(["PAID", "READY_FOR_PRODUCTION"]);

export async function rememberAttribution(db, orderId, attribution, now) {
  const clean = sanitizeAttribution(attribution);
  if (!orderId || !hasAttribution(clean)) return { stored: false };
  await db.run(
    `INSERT INTO order_attribution (order_id, gclid, gbraid, wbraid, stored_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(order_id) DO NOTHING`,
    [orderId, clean.gclid, clean.gbraid, clean.wbraid, now]
  );
  return { stored: true };
}

export async function claimPurchaseConversion(db, sessionId, accessToken, now) {
  const auth = await readAuthorizedOrder(db, sessionId, accessToken);
  if (auth.status !== 200) return { status: auth.status, body: { ok: false, emit: false, code: "not_found" } };
  if (!PAID_STATES.has(auth.body.state) || auth.body.confirmed !== true) {
    return { status: 200, body: { ok: true, emit: false, reason: "not_paid" } };
  }
  const priced = purchaseValue(auth.order.amount_total, auth.order.currency);
  if (!priced) return { status: 200, body: { ok: true, emit: false, reason: "no_value" } };

  const stamp = now || new Date().toISOString();
  await db.run(
    `INSERT INTO order_attribution (order_id, gclid, gbraid, wbraid, stored_at)
     VALUES (?, NULL, NULL, NULL, ?)
     ON CONFLICT(order_id) DO NOTHING`,
    [auth.order.id, stamp]
  );
  const claimed = await db.run(
    `UPDATE order_attribution
     SET purchase_conversion_claimed_at = ?
     WHERE order_id = ? AND purchase_conversion_claimed_at IS NULL`,
    [stamp, auth.order.id]
  );
  if (!claimed.changes) return { status: 200, body: { ok: true, emit: false, reason: "duplicate" } };
  const clicks = await db.get(
    "SELECT gclid, gbraid, wbraid FROM order_attribution WHERE order_id = ?",
    [auth.order.id]
  );
  return {
    status: 200,
    body: {
      ok: true,
      emit: true,
      transaction_id: auth.order.id,
      value: priced.value,
      currency: priced.currency,
      gclid: clicks && clicks.gclid ? clicks.gclid : null,
      gbraid: clicks && clicks.gbraid ? clicks.gbraid : null,
      wbraid: clicks && clicks.wbraid ? clicks.wbraid : null,
    },
  };
}

export async function claimInquiryConversion(db, inquiryId, now) {
  if (typeof inquiryId !== "string" || !/^inq_[A-Za-z0-9_-]{8,80}$/.test(inquiryId)) {
    return { status: 404, body: { ok: false, emit: false, code: "not_found" } };
  }
  const stamp = now || new Date().toISOString();
  const claimed = await db.run(
    `UPDATE inquiries
     SET conversion_claimed_at = ?
     WHERE id = ? AND conversion_claimed_at IS NULL`,
    [stamp, inquiryId]
  );
  if (!claimed.changes) return { status: 200, body: { ok: true, emit: false, reason: "duplicate" } };
  return { status: 200, body: { ok: true, emit: true, transaction_id: inquiryId } };
}
