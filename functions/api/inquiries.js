import { acceptInquiry } from "../_shared/inquiry.js";
import { d1Adapter } from "../_shared/order-db.js";
import { assertWebsiteOrdersDb } from "../_shared/production-guard.js";
import { jsonResponse } from "../_shared/stripe.js";

export async function onRequestPost(context) {
  const orders = assertWebsiteOrdersDb(context.env || {});
  if (!orders.ok) {
    return jsonResponse({ ok: false, code: "missing_website_orders" }, 503);
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, code: "invalid_json" }, 400);
  }
  try {
    const result = await acceptInquiry(d1Adapter(context.env.WEBSITE_ORDERS), context.env || {}, {
      body,
      ip: context.request.headers.get("CF-Connecting-IP") || "",
    });
    return jsonResponse(result.body, result.status);
  } catch {
    return jsonResponse({ ok: false, code: "inquiry_not_ready" }, 503);
  }
}
