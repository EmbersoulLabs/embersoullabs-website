import { progressInquiryConversion } from "../../_shared/conversion.js";
import { d1Adapter } from "../../_shared/order-db.js";
import { assertWebsiteOrdersDb } from "../../_shared/production-guard.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestPost(context) {
  const orders = assertWebsiteOrdersDb(context.env || {});
  if (!orders.ok) {
    return jsonResponse({ ok: false, emit: false, code: "missing_website_orders" }, 503);
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, emit: false, code: "invalid_json" }, 400);
  }
  try {
    const result = await progressInquiryConversion(
      d1Adapter(context.env.WEBSITE_ORDERS),
      body && body.inquiry_id,
      body && body.phase ? body.phase : "reserve"
    );
    return jsonResponse(result.body, result.status);
  } catch {
    return jsonResponse({ ok: false, emit: false, code: "measurement_not_ready" }, 503);
  }
}
