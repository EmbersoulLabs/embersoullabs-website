import { handleEmbercoreEvent } from "../../_shared/portal-embercore.js";
import { portalDatabase } from "../../_shared/portal-http.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestPost(context) {
  const ready = portalDatabase(context.env);
  if (ready.error) return ready.error;
  const raw = await context.request.text();
  const result = await handleEmbercoreEvent(
    ready.db,
    context.env,
    raw,
    context.request.headers.get("X-EmberCore-Signature"),
    new Date().toISOString(),
    context.env && context.env.ASSET_BUCKET
  );
  return jsonResponse(result.body, result.status);
}
