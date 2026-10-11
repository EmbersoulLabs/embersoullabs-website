import { d1Adapter } from "./order-db.js";
import { requireCustomer } from "./portal-auth.js";
import { assertWebsiteOrdersDb } from "./production-guard.js";
import { jsonResponse } from "./stripe.js";

export function portalDatabase(env) {
  const orders = assertWebsiteOrdersDb(env || {});
  if (!orders.ok) {
    return { error: jsonResponse({ ok: false, code: "missing_website_orders" }, 503) };
  }
  return { db: d1Adapter(env.WEBSITE_ORDERS) };
}

export async function customerContext(env, request) {
  const ready = portalDatabase(env);
  if (ready.error) return ready;
  const now = new Date().toISOString();
  const auth = await requireCustomer(ready.db, request, now);
  if (auth.status !== 200) return { error: jsonResponse(auth.body, auth.status) };
  return { db: ready.db, customer: auth.customer, now };
}

export async function readJson(request) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: jsonResponse({ ok: false, code: "invalid_json" }, 400) };
  }
}
