/**
 * GET /api/checkout/session?session_id=cs_...
 *
 * Success-page verification only.
 * Returns minimal status — no customer PII / email / address / payment method details.
 */
import { classifyPaymentState } from "../../_shared/production-guard.js";
import {
  assertAllowedSecret,
  corsHeaders,
  jsonResponse,
  stripeRequest,
} from "../../_shared/stripe.js";

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "*";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "*";
  const headers = corsHeaders(origin);

  const secret = context.env.STRIPE_SECRET_KEY;
  const modeCheck = assertAllowedSecret(secret);
  if (!modeCheck.ok) {
    return jsonResponse({ ok: false, error: modeCheck.error, code: "missing_stripe_secret" }, 503, headers);
  }

  const url = new URL(context.request.url);
  const sessionId = (url.searchParams.get("session_id") || "").trim();
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId) && !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return jsonResponse(
      { ok: false, error: "Invalid or missing session_id", code: "invalid_session" },
      400,
      headers
    );
  }

  const { status, data } = await stripeRequest(
    secret,
    "GET",
    `checkout/sessions/${encodeURIComponent(sessionId)}`
  );

  if (data.error) {
    // Do not leak whether a session exists beyond a generic failure for foreign IDs.
    return jsonResponse(
      {
        ok: false,
        error: "Unable to verify payment session",
        code: "session_lookup_failed",
        payment_state: "PENDING",
      },
      status === 404 ? 404 : status >= 400 ? status : 502,
      headers
    );
  }

  const classification = classifyPaymentState(data, null);
  const paid = classification.state === "CONFIRMED";

  // Minimal payload for UI — no customer email, name, phone, address, payment_method details.
  return jsonResponse(
    {
      ok: true,
      verified: true,
      paid,
      payment_state: classification.state,
      payment_status: data.payment_status,
      session_status: data.status,
      session_id: data.id,
      reference: data.id,
      service: (data.metadata && data.metadata.service) || null,
      region: (data.metadata && data.metadata.region) || null,
      next_step: paid ? "submit_creative_brief" : "awaiting_payment_confirmation",
      emberos_production: "not_connected",
    },
    200,
    headers
  );
}
