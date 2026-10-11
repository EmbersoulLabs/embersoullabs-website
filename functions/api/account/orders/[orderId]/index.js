import { getOwnedOrder } from "../../../../_shared/portal-orders.js";
import { customerContext } from "../../../../_shared/portal-http.js";
import { jsonResponse } from "../../../../_shared/stripe.js";

export async function onRequestGet(context) {
  const ctx = await customerContext(context.env, context.request);
  if (ctx.error) return ctx.error;
  const result = await getOwnedOrder(ctx.db, ctx.customer, context.params.orderId);
  return jsonResponse(result.body, result.status);
}
