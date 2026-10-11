import { clearSessionCookie, cookieSecure, readCookie, revokeSession, PORTAL_COOKIE } from "../../_shared/portal-auth.js";
import { portalDatabase } from "../../_shared/portal-http.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestPost(context) {
  const ready = portalDatabase(context.env);
  if (ready.error) return ready.error;
  const now = new Date().toISOString();
  await revokeSession(ready.db, readCookie(context.request, PORTAL_COOKIE), now);
  return jsonResponse(
    { ok: true },
    200,
    { "Set-Cookie": clearSessionCookie({ secure: cookieSecure(context.env, context.request) }) }
  );
}
