import { startLogin } from "../../_shared/portal-auth.js";
import { portalDatabase, readJson } from "../../_shared/portal-http.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestPost(context) {
  const ready = portalDatabase(context.env);
  if (ready.error) return ready.error;
  const input = await readJson(context.request);
  if (input.error) return input.error;
  const result = await startLogin(ready.db, context.env, {
    email: input.body.email,
    ip: context.request.headers.get("CF-Connecting-IP") || "",
    origin: context.env && context.env.SITE_ORIGIN,
    now: new Date().toISOString(),
  });
  return jsonResponse(result.body, result.status);
}
