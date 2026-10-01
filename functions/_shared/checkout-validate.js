/**
 * Checkout request validation (pure — no Stripe calls).
 * Client may only supply service + region. Everything else is rejected.
 */
import {
  getExpectedAmount,
  getLookupKey,
  normalizeRegion,
  normalizeService,
} from "./catalog.js";

const FORBIDDEN_PAYMENT_FIELDS = [
  "amount",
  "unit_amount",
  "price",
  "priceId",
  "price_id",
  "currency",
  "lookup_key",
  "lookupKey",
  "displayed_price",
  "displayedPrice",
];

export function validateCheckoutBody(body) {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      code: "invalid_json",
      error: "Invalid JSON body. Send { service, region }.",
    };
  }

  for (const field of FORBIDDEN_PAYMENT_FIELDS) {
    if (body[field] != null) {
      return {
        ok: false,
        code: "client_amount_rejected",
        error:
          "Client-submitted payment fields are not accepted. Send only { service, region }.",
        field,
      };
    }
  }

  const service = normalizeService(body.service);
  const region = normalizeRegion(body.region);

  if (!service) {
    return {
      ok: false,
      code: "invalid_service",
      error: "Invalid service. Allowed: short | story | monthly",
    };
  }
  if (!region) {
    return {
      ok: false,
      code: "invalid_region",
      error: "Invalid region. Allowed: my | sg | intl",
    };
  }

  const lookupKey = getLookupKey(service, region);
  if (!lookupKey) {
    return {
      ok: false,
      code: "mapping_failed",
      error: "Unable to resolve lookup key",
    };
  }

  return {
    ok: true,
    service,
    region,
    lookupKey,
    expected: getExpectedAmount(lookupKey),
  };
}
