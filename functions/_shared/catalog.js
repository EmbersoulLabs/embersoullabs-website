/**
 * Approved Stripe catalog (server-side only).
 * Maps (service, region) → lookup_key.
 * Amounts are documented for validation only — Checkout must resolve
 * the Stripe Price by lookup_key, never by client-submitted amounts.
 *
 * Purchasable v2 prices are ONE-TIME regional amounts, not FX conversions.
 * Legacy v1 keys stay so historical orders and webhook replays still match.
 * No subscriptions.
 */

export const PURCHASABLE_SERVICES = Object.freeze(["product", "narrative", "series"]);
export const LEGACY_SERVICES = Object.freeze(["short", "story", "monthly"]);
export const ALLOWED_SERVICES = Object.freeze([
  ...PURCHASABLE_SERVICES,
  ...LEGACY_SERVICES,
]);
export const ALLOWED_REGIONS = Object.freeze(["my", "sg", "intl"]);

/** Public checkout lookup keys. Distinct from historical v1 keys. */
export const LOOKUP_KEYS = Object.freeze({
  product: Object.freeze({
    my: "product_commercial_my_v2",
    sg: "product_commercial_sg_v2",
    intl: "product_commercial_intl_v2",
  }),
  narrative: Object.freeze({
    my: "story_commercial_my_v2",
    sg: "story_commercial_sg_v2",
    intl: "story_commercial_intl_v2",
  }),
  series: Object.freeze({
    my: "story_series_my_v2",
    sg: "story_series_sg_v2",
    intl: "story_series_intl_v2",
  }),
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
  product_commercial_my_v2: { currency: "myr", unit_amount: 18900 },
  product_commercial_sg_v2: { currency: "sgd", unit_amount: 7900 },
  product_commercial_intl_v2: { currency: "usd", unit_amount: 5900 },
  story_commercial_my_v2: { currency: "myr", unit_amount: 39900 },
  story_commercial_sg_v2: { currency: "sgd", unit_amount: 16900 },
  story_commercial_intl_v2: { currency: "usd", unit_amount: 12900 },
  story_series_my_v2: { currency: "myr", unit_amount: 69900 },
  story_series_sg_v2: { currency: "sgd", unit_amount: 29900 },
  story_series_intl_v2: { currency: "usd", unit_amount: 22900 },
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
  product: "Product Commercial",
  narrative: "Story Commercial",
  series: "Monthly Story Series",
  short: "AI Short Ad",
  story: "AI Story Ad",
  monthly: "Monthly AI Content",
});

/** Website-side deliverable facts copied into Checkout metadata. */
export const PACKAGE_FACTS = Object.freeze({
  product: Object.freeze({
    duration: "15-20s",
    episodes: "1",
    continuity: "single",
    deliverable: "one_finished_commercial",
  }),
  narrative: Object.freeze({
    duration: "48-60s",
    episodes: "1",
    continuity: "single",
    deliverable: "one_story_commercial",
  }),
  series: Object.freeze({
    duration: "30-45s",
    episodes: "4",
    continuity: "connected",
    deliverable: "four_connected_episodes",
  }),
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

export function isPurchasableService(service) {
  return PURCHASABLE_SERVICES.includes(service);
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

export function getPackageFacts(service) {
  const s = normalizeService(service);
  return (s && PACKAGE_FACTS[s]) || null;
}
