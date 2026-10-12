/**
 * POST /api/checkout
 *
 * Trusted Checkout Session creation.
 * Accepts ONLY: { service, region }
 *
 * Production requires:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_ORIGIN, PAYMENT_EVENTS
 * Success/cancel URLs always from configured SITE_ORIGIN (never Host header in prod).
 */
import { sanitizeAttribution } from "../_shared/attribution.js";
import { validateCheckoutBody } from "../_shared/checkout-validate.js";
import {
  assertProductionCheckoutReady,
  resolveSiteOrigin,
} from "../_shared/production-guard.js";
import { persistCheckoutSession, recoverWebsiteCheckout } from "../_shared/checkout-order.js";
import { d1Adapter } from "../_shared/order-db.js";
import {
  assertAllowedSecret,
  corsHeaders,
  jsonResponse,
  resolvePriceByLookupKey,
  stripeRequest,
} from "../_shared/stripe.js";

function ordersDb(env) {
  const binding = env && env.WEBSITE_ORDERS;
  if (!binding || typeof binding.prepare !== "function") return null;
  return d1Adapter(binding);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "*";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "*";
  const headers = corsHeaders(origin);

  try {
    const readiness = assertProductionCheckoutReady(context.env);
    if (!readiness.ok) {
      return jsonResponse(
        {
          ok: false,
          error: readiness.error,
          code: readiness.code || "not_ready",
          missing: readiness.missing || readiness.missing_for_production,
          emberos_production: "not_connected",
        },
        503,
        headers
      );
    }

    const secret = context.env.STRIPE_SECRET_KEY;
    const modeCheck = assertAllowedSecret(secret);
    if (!modeCheck.ok) {
      return jsonResponse({ ok: false, error: modeCheck.error }, 503, headers);
    }

    let body;
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body. Send { service, region }.",
          code: "invalid_json",
        },
        400,
        headers
      );
    }

    if (body && typeof body === "object" && body.recovery_handle) {
      const db = ordersDb(context.env);
      if (!db) {
        return jsonResponse(
          { ok: false, code: "missing_website_orders", emberos_production: "not_connected" },
          503,
          headers
        );
      }
      const recovered = await recoverWebsiteCheckout({
        db,
        env: context.env,
        handle: body.recovery_handle,
        stripeRequest,
      });
      return jsonResponse(recovered.body, recovered.status, headers);
    }

    const validated = validateCheckoutBody(body);
    if (!validated.ok) {
      return jsonResponse(
        {
          ok: false,
          error: validated.error,
          code: validated.code,
          field: validated.field,
        },
        400,
        headers
      );
    }

    const { service, region, lookupKey, expected } = validated;
    const attribution = sanitizeAttribution(body && body.attribution);

    if (body.dry_run === true) {
      const resolved = await resolvePriceByLookupKey(secret, lookupKey, expected);
      if (!resolved.ok) {
        return jsonResponse(
          {
            ok: false,
            error: resolved.error,
            code: resolved.code || "price_unresolved",
            lookupKey,
            service,
            region,
            dry_run: true,
          },
          503,
          headers
        );
      }
      return jsonResponse(
        {
          ok: true,
          dry_run: true,
          service,
          region,
          lookupKey,
          priceId: resolved.price.id,
          mode: modeCheck.mode,
          session_created: false,
        },
        200,
        headers
      );
    }

    const resolved = await resolvePriceByLookupKey(secret, lookupKey, expected);
    if (!resolved.ok) {
      return jsonResponse(
        {
          ok: false,
          error: resolved.error,
          code: resolved.code || "price_unresolved",
          lookupKey,
          service,
          region,
          checkout_available: false,
        },
        503,
        headers
      );
    }

    const site = resolveSiteOrigin(context.env, context.request.url);
    if (!site.ok) {
      return jsonResponse(
        { ok: false, error: site.error, code: site.code },
        503,
        headers
      );
    }

    const db = ordersDb(context.env);
    if (!db) {
      return jsonResponse(
        {
          ok: false,
          code: "missing_website_orders",
          error: "WEBSITE_ORDERS D1 binding is required before a Checkout URL can be returned",
          emberos_production: "not_connected",
        },
        503,
        headers
      );
    }

    const placed = await persistCheckoutSession({
      db,
      env: context.env,
      origin: site.origin,
      service,
      region,
      lookupKey,
      price: resolved.price,
      attribution,
      stripeRequest,
    });
    return jsonResponse(
      { ...placed.body, mode: placed.body && placed.body.ok ? modeCheck.mode : undefined },
      placed.status,
      headers
    );
  } catch (err) {
    return jsonResponse(
      { ok: false, error: "Checkout endpoint error", code: "internal_error" },
      500,
      headers
    );
  }
}

export async function onRequestGet(context) {
  const readiness = assertProductionCheckoutReady(context.env || {});
  return jsonResponse(
    {
      ok: false,
      error: "Use POST with JSON body { service, region }",
      accepts: {
        service: ["short", "story", "monthly"],
        region: ["my", "sg", "intl"],
      },
      client_amounts: "rejected",
      readiness: {
        ok: readiness.ok,
        mode: readiness.mode,
        missing: readiness.missing || readiness.missing_for_production || [],
      },
    },
    405
  );
}
