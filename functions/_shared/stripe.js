/**
 * Minimal Stripe REST helpers for Cloudflare Pages Functions.
 * Secret key must come from env (STRIPE_SECRET_KEY). Never ship to client.
 */

export function assertAllowedSecret(secret) {
  if (!secret || typeof secret !== "string") {
    return { ok: false, error: "STRIPE_SECRET_KEY is not configured" };
  }
  if (secret.startsWith("sk_live_") || secret.startsWith("rk_live_")) {
    return { ok: true, mode: "live" };
  }
  if (secret.startsWith("sk_test_") || secret.startsWith("rk_test_")) {
    return { ok: true, mode: "test" };
  }
  return {
    ok: false,
    error: "STRIPE_SECRET_KEY must be a Stripe secret/restricted key (sk_/rk_)",
  };
}

/** @deprecated use assertAllowedSecret — kept name for older imports */
export function assertTestModeSecret(secret) {
  return assertAllowedSecret(secret);
}

export async function stripeRequest(secret, method, path, body) {
  const headers = {
    Authorization: `Bearer ${secret}`,
  };
  let payload;
  if (body != null) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload =
      typeof body === "string" ? body : new URLSearchParams(body).toString();
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers,
    body: payload,
  });
  const data = await res.json();
  return { status: res.status, data };
}

/**
 * Resolve an active one-time Price by lookup_key.
 * Fails closed if missing, inactive, recurring, or amount/currency mismatch.
 */
export async function resolvePriceByLookupKey(secret, lookupKey, expected) {
  const qs = new URLSearchParams();
  qs.append("lookup_keys[]", lookupKey);
  qs.append("active", "true");
  qs.append("limit", "1");

  const { status, data } = await stripeRequest(
    secret,
    "GET",
    `prices?${qs.toString()}`
  );

  if (data.error) {
    return {
      ok: false,
      code: "stripe_error",
      error: data.error.message || "Stripe price lookup failed",
      status,
    };
  }

  const price = data.data && data.data[0];
  if (!price) {
    return {
      ok: false,
      code: "lookup_key_missing",
      error: `No active Stripe Price found for lookup_key=${lookupKey}`,
      lookupKey,
    };
  }

  if (price.type !== "one_time") {
    return {
      ok: false,
      code: "not_one_time",
      error: `Price for ${lookupKey} is not one_time (got ${price.type})`,
      lookupKey,
      priceId: price.id,
    };
  }

  if (expected) {
    if (price.currency !== expected.currency) {
      return {
        ok: false,
        code: "currency_mismatch",
        error: `Currency mismatch for ${lookupKey}`,
        lookupKey,
        priceId: price.id,
        expected: expected.currency,
        got: price.currency,
      };
    }
    if (price.unit_amount !== expected.unit_amount) {
      return {
        ok: false,
        code: "amount_mismatch",
        error: `Unit amount mismatch for ${lookupKey}`,
        lookupKey,
        priceId: price.id,
        expected: expected.unit_amount,
        got: price.unit_amount,
      };
    }
  }

  return { ok: true, price };
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
