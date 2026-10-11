import { claimOrder, listOrders } from "../../../_shared/portal-orders.js";
import { customerContext, readJson } from "../../../_shared/portal-http.js";
import { jsonResponse } from "../../../_shared/stripe.js";

export async function onRequestGet(context) {
  const ctx = await customerContext(context.env, context.request);
  if (ctx.error) return ctx.error;
  const url = new URL(context.request.url);
  const result = await listOrders(ctx.db, ctx.customer, {
    payment: url.searchParams.get("payment") || "",
    progress: url.searchParams.get("progress") || "",
  });
  return jsonResponse(result.body, result.status);
}

export async function onRequestPost(context) {
  const ctx = await customerContext(context.env, context.request);
  if (ctx.error) return ctx.error;
  const input = await readJson(context.request);
  if (input.error) return input.error;
  const result = await claimOrder(ctx.db, ctx.customer, {
    sessionId: input.body.session_id,
    accessToken: input.body.access_token,
    now: ctx.now,
  });
  return jsonResponse(result.body, result.status);
}
