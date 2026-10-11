/**
 * POST /api/orders/brief
 * Completes a creative brief for a paid website order.
 * Does not create an EmberOS job.
 */
import { randomToken, submitCreativeBrief } from "../../_shared/order-access.js";
import { d1Adapter } from "../../_shared/order-db.js";
import { assertWebsiteOrdersDb } from "../../_shared/production-guard.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const orders = assertWebsiteOrdersDb(env);
  if (!orders.ok) {
    return jsonResponse(
      { ok: false, code: "missing_website_orders", emberos_production: "not_connected" },
      503
    );
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, code: "invalid_json" }, 400);
  }
  const result = await submitCreativeBrief(d1Adapter(env.WEBSITE_ORDERS), {
    sessionId: body.session_id,
    accessToken: body.access_token,
    promotionText: body.promotion_text,
    language: body.language,
    assetStatus: body.asset_status,
    contact: body.contact,
    briefId: randomToken(16),
  });
  return jsonResponse(result.body, result.status);
}
