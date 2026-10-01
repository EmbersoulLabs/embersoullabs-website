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
import { SERVICE_LABELS } from "../_shared/catalog.js";
import { validateCheckoutBody } from "../_shared/checkout-validate.js";
import {
  assertProductionCheckoutReady,
  resolveSiteOrigin,
} from "../_shared/production-guard.js";
import {
  assertAllowedSecret,
  corsHeaders,
  jsonResponse,
  resolvePriceByLookupKey,
  stripeRequest,
} from "../_shared/stripe.js";

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

    const successUrl = `${site.origin}/ai-ads/checkout/success/?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${site.origin}/ai-ads/checkout/cancel/?service=${encodeURIComponent(
      service
    )}&region=${encodeURIComponent(region)}`;

    const form = {
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      "line_items[0][price]": resolved.price.id,
      "line_items[0][quantity]": "1",
      "metadata[service]": service,
      "metadata[region]": region,
      "metadata[lookup_key]": lookupKey,
      "metadata[package_version]": "ai_ads_v1",
      "metadata[product_label]": SERVICE_LABELS[service],
      "metadata[source]": "embersoul_ai_ads_website",
      "payment_intent_data[metadata][service]": service,
      "payment_intent_data[metadata][region]": region,
      "payment_intent_data[metadata][lookup_key]": lookupKey,
      "payment_intent_data[metadata][package_version]": "ai_ads_v1",
    };

    const { status, data } = await stripeRequest(
      secret,
      "POST",
      "checkout/sessions",
      form
    );

    if (data.error || !data.url) {
      return jsonResponse(
        {
          ok: false,
          error:
            (data.error && data.error.message) ||
            "Failed to create Checkout Session",
          code: "session_create_failed",
        },
        status >= 400 ? status : 502,
        headers
      );
    }

    return jsonResponse(
      {
        ok: true,
        url: data.url,
        sessionId: data.id,
        service,
        region,
        lookupKey,
        mode: modeCheck.mode,
      },
      200,
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
