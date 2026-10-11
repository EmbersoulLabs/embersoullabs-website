import { requireCustomer } from "../../_shared/portal-auth.js";
import { portalDatabase } from "../../_shared/portal-http.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestGet(context) {
  const ready = portalDatabase(context.env);
  if (ready.error) return ready.error;
  const auth = await requireCustomer(ready.db, context.request, new Date().toISOString());
  if (auth.status !== 200) return jsonResponse(auth.body, auth.status);
  return jsonResponse({
    ok: true,
    customer_id: auth.customer.id,
    email: auth.customer.email,
    embercore_sync_live: false,
  });
}
