import { requestRevision } from "../../../../_shared/portal-orders.js";
import { customerContext, readJson } from "../../../../_shared/portal-http.js";
import { jsonResponse } from "../../../../_shared/stripe.js";

export async function onRequestPost(context) {
  const ctx = await customerContext(context.env, context.request);
  if (ctx.error) return ctx.error;
  const input = await readJson(context.request);
  if (input.error) return input.error;
  const result = await requestRevision(ctx.db, ctx.customer, context.params.orderId, input.body, ctx.now);
  return jsonResponse(result.body, result.status);
}
