/**
 * Approved Stripe catalog (server-side only).
 * Maps (service, region) → lookup_key.
 * Amounts are documented for validation only — Checkout must resolve
 * the live Stripe Price by lookup_key, never by client-submitted amounts.
 *
 * All v1 prices are ONE-TIME. No subscriptions.
 */

export const ALLOWED_SERVICES = Object.freeze(["short", "story", "monthly"]);
export const ALLOWED_REGIONS = Object.freeze(["my", "sg", "intl"]);

/** Approved lookup keys — must match Stripe Dashboard / Price.lookup_key */
export const LOOKUP_KEYS = Object.freeze({
  short: Object.freeze({
    my: "ai_short_ad_my",
    sg: "ai_short_ad_sg",
    intl: "ai_short_ad_intl",
  }),
  story: Object.freeze({
    my: "ai_story_ad_my",
    sg: "ai_story_ad_sg",
    intl: "ai_story_ad_intl",
  }),
  monthly: Object.freeze({
    my: "monthly_ai_content_my",
    sg: "monthly_ai_content_sg",
    intl: "monthly_ai_content_intl",
  }),
});

/**
 * Expected unit amounts in minor units (for fail-closed amount checks
 * after Stripe Price resolution). Not used to create Checkout amounts.
 */
export const EXPECTED_UNIT_AMOUNTS = Object.freeze({
  ai_short_ad_my: { currency: "myr", unit_amount: 6900 },
  ai_short_ad_sg: { currency: "sgd", unit_amount: 2900 },
  ai_short_ad_intl: { currency: "usd", unit_amount: 1900 },
  ai_story_ad_my: { currency: "myr", unit_amount: 18900 },
  ai_story_ad_sg: { currency: "sgd", unit_amount: 7900 },
  ai_story_ad_intl: { currency: "usd", unit_amount: 5900 },
  monthly_ai_content_my: { currency: "myr", unit_amount: 49900 },
  monthly_ai_content_sg: { currency: "sgd", unit_amount: 19900 },
  monthly_ai_content_intl: { currency: "usd", unit_amount: 12900 },
});

export const SERVICE_LABELS = Object.freeze({
  short: "AI Short Ad",
  story: "AI Story Ad",
  monthly: "Monthly AI Content",
});

export function normalizeService(raw) {
  if (!raw) return null;
  const v = String(raw).toLowerCase().trim();
  return ALLOWED_SERVICES.includes(v) ? v : null;
}

export function normalizeRegion(raw) {
  if (!raw) return null;
  const v = String(raw).toLowerCase().trim();
  if (v === "sg" || v === "singapore" || v === "sgd") return "sg";
  if (v === "my" || v === "malaysia" || v === "myr" || v === "rm") return "my";
  if (v === "intl" || v === "international" || v === "usd" || v === "us") return "intl";
  return ALLOWED_REGIONS.includes(v) ? v : null;
}

export function getLookupKey(service, region) {
  const s = normalizeService(service);
  const r = normalizeRegion(region);
  if (!s || !r) return null;
  return LOOKUP_KEYS[s][r];
}

export function getExpectedAmount(lookupKey) {
  return EXPECTED_UNIT_AMOUNTS[lookupKey] || null;
}
