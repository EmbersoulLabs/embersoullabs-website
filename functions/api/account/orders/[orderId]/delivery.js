import { createDownloadGrant } from "../../../../_shared/portal-orders.js";
import { customerContext } from "../../../../_shared/portal-http.js";
import { jsonResponse } from "../../../../_shared/stripe.js";

export async function onRequestPost(context) {
  const ctx = await customerContext(context.env, context.request);
  if (ctx.error) return ctx.error;
  const result = await createDownloadGrant(ctx.db, ctx.customer, context.params.orderId, ctx.now);
  return jsonResponse(result.body, result.status);
}
