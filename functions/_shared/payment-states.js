/**
 * Payment state reference (documentation module — imported by tests/guards).
 *
 * CONFIRMED (order-eligible later; EmberOS still disconnected):
 *   - Checkout Session payment_status = paid
 *   - Checkout Session payment_status = no_payment_required
 *   - Event: checkout.session.async_payment_succeeded
 *
 * PENDING (do NOT create confirmed order):
 *   - checkout.session.completed with payment_status = unpaid
 *     (common for async bank/redirect methods still settling)
 *   - Session status open / awaiting customer action
 *
 * FAILED (do NOT create order):
 *   - Event: checkout.session.async_payment_failed
 *   - Session status = expired
 *
 * Success URL alone is never CONFIRMED authority.
 * Webhook + Stripe Session verification are authoritative.
 */
export const PAYMENT_STATE_DOCS = {
  CONFIRMED: [
    "payment_status=paid",
    "payment_status=no_payment_required",
    "checkout.session.async_payment_succeeded",
  ],
  PENDING: [
    "checkout.session.completed + payment_status=unpaid",
    "session status open / awaiting settlement",
  ],
  FAILED: [
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
    "session status=expired",
  ],
};
