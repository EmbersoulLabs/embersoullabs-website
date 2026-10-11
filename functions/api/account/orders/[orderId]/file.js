import { readDeliveryObject } from "../../../../_shared/portal-orders.js";
import { customerContext } from "../../../../_shared/portal-http.js";
import { jsonResponse } from "../../../../_shared/stripe.js";

export async function onRequestGet(context) {
  const ctx = await customerContext(context.env, context.request);
  if (ctx.error) return ctx.error;
  const grant = new URL(context.request.url).searchParams.get("grant");
  const result = await readDeliveryObject(ctx.db, ctx.customer, context.env, context.params.orderId, grant, ctx.now);
  if (result.bytes) {
    const bytes = result.bytes instanceof Uint8Array ? result.bytes : result.bytes.bytes;
    return new Response(bytes, { status: 200, headers: result.headers });
  }
  return jsonResponse(result.body, result.status);
}
