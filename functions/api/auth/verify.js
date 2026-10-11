import { cookieSecure, verifyLogin } from "../../_shared/portal-auth.js";
import { portalDatabase, readJson } from "../../_shared/portal-http.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestPost(context) {
  const ready = portalDatabase(context.env);
  if (ready.error) return ready.error;
  const input = await readJson(context.request);
  if (input.error) return input.error;
  const result = await verifyLogin(ready.db, context.env, {
    email: input.body.email,
    code: input.body.code,
    challengeId: input.body.challenge,
    ip: context.request.headers.get("CF-Connecting-IP") || "",
    secure: cookieSecure(context.env, context.request),
    now: new Date().toISOString(),
  });
  const headers = result.cookie ? { "Set-Cookie": result.cookie } : {};
  return jsonResponse(result.body, result.status, headers);
}
