/**
 * GET /api/diag/bindings
 *
 * TEMPORARY safe runtime diagnostic for Cloudflare Pages binding issues.
 * Reports PAYMENT_EVENTS type/capabilities only — never secret values or KV contents.
 */
import {
  describePaymentEventsBinding,
  getRuntimeMode,
} from "../../_shared/production-guard.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const binding = env.PAYMENT_EVENTS;
  const probe = describePaymentEventsBinding(binding);

  // Booleans only for known non-secret / secret-present flags — never values.
  const flags = {
    SITE_ORIGIN_present: typeof env.SITE_ORIGIN === "string" && !!env.SITE_ORIGIN,
    SITE_ORIGIN_is_production_host:
      typeof env.SITE_ORIGIN === "string" &&
      env.SITE_ORIGIN.replace(/\/$/, "") === "https://embersoullabs.com",
    STRIPE_SECRET_KEY_present: typeof env.STRIPE_SECRET_KEY === "string",
    STRIPE_WEBHOOK_SECRET_present: typeof env.STRIPE_WEBHOOK_SECRET === "string",
    ENVIRONMENT_present: typeof env.ENVIRONMENT === "string",
    // Detect accidental plain env var collision (string) vs KV object.
    PAYMENT_EVENTS_is_string: typeof binding === "string",
    PAYMENT_EVENTS_is_object: typeof binding === "object" && binding !== null,
  };

  return jsonResponse({
    ok: true,
    diagnostic: true,
    runtime_mode: getRuntimeMode(env),
    context_env_received: !!context.env,
    payment_events_present: probe.present,
    payment_events_type: probe.type,
    has_get: probe.has_get,
    has_put: probe.has_put,
    has_delete: probe.has_delete,
    looks_like_kv: probe.looks_like_kv,
    flags,
    note:
      "If payment_events_present=false while Dashboard shows a KV binding, the running deployment likely predates the binding or Production vs Preview binding differs. If type=string, remove the plain Environment Variable named PAYMENT_EVENTS.",
  });
}
