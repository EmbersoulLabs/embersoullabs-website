/**
 * GET /api/orders/status?session_id=&access_token=
 * Reads the website order ledger. A Stripe redirect cannot set PAID.
 */
import { readAuthorizedOrder } from "../../_shared/order-access.js";
import { d1Adapter } from "../../_shared/order-db.js";
import { assertWebsiteOrdersDb } from "../../_shared/production-guard.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const orders = assertWebsiteOrdersDb(env);
  if (!orders.ok) {
    return jsonResponse(
      { ok: false, code: "missing_website_orders", emberos_production: "not_connected" },
      503
    );
  }
  const url = new URL(context.request.url);
  const result = await readAuthorizedOrder(
    d1Adapter(env.WEBSITE_ORDERS),
    url.searchParams.get("session_id"),
    url.searchParams.get("access_token")
  );
  return jsonResponse(result.body, result.status);
}
