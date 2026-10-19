/**
 * Lightweight Node checks for regional pricing tables (no browser deps).
 * Run: node js/pricing.check.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const pricingSrc = readFileSync(join(__dirname, "pricing.js"), "utf8");
const stripeSrc = readFileSync(join(__dirname, "stripe-config.js"), "utf8");
const homeSrc = readFileSync(join(root, "index.html"), "utf8");
const formSrc = readFileSync(join(root, "ai-ads", "index.html"), "utf8");

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

function assertIncludes(src, s, label) {
  assert(src.includes(s), (label || "") + " includes " + s);
}

function assertNotIncludes(src, s, label) {
  assert(!src.includes(s), (label || "") + " must NOT include " + s);
}

// Fixed regional display strings (single source: pricing.js)
[
  "RM 69",
  "RM 189",
  "RM 499 / 30-day package",
  "SGD 29",
  "SGD 79",
  "SGD 199 / 30-day package",
  "USD 19",
  "USD 59",
  "USD 129 / 30-day package",
].forEach((s) => assertIncludes(pricingSrc, s, "pricing.js"));

assertIncludes(pricingSrc, "embersoul_pricing_region", "pricing.js");
assertIncludes(pricingSrc, "history.replaceState", "pricing.js keeps a manual market in the URL");
assertIncludes(pricingSrc, "if (getManualRegion()) return;", "pricing.js does not let detection override a manual market");
assertIncludes(pricingSrc, "/cdn-cgi/trace", "pricing.js");
assertIncludes(pricingSrc, 'amount: 129', "pricing.js monthly USD amount");
assertIncludes(pricingSrc, "one_time_30_day", "pricing.js monthly billing");

// Amount sanity — scope to PRICES table only
const pricesBlock = (pricingSrc.match(/var PRICES = \{([\s\S]*?)\n  \};/) || [])[1] || "";

function hasAmount(region, offer, amount) {
  const regionBlock = (pricesBlock.match(
    new RegExp(region + ":\\s*\\{([\\s\\S]*?)\\n\\s{4}\\},")
  ) || [])[1];
  if (!regionBlock) return false;
  const re = new RegExp(
    offer + ":\\s*\\{[\\s\\S]*?amount:\\s*" + amount + "\\b"
  );
  return re.test(regionBlock);
}

assert(hasAmount("my", "short", 69), "MY short = 69");
assert(hasAmount("my", "story", 189), "MY story = 189");
assert(hasAmount("my", "monthly", 499), "MY monthly = 499");
assert(hasAmount("sg", "short", 29), "SG short = 29");
assert(hasAmount("sg", "story", 79), "SG story = 79");
assert(hasAmount("sg", "monthly", 199), "SG monthly = 199");
assert(hasAmount("intl", "short", 19), "INTL short = 19");
assert(hasAmount("intl", "story", 59), "INTL story = 59");
assert(hasAmount("intl", "monthly", 129), "INTL monthly = 129");

// Standard package tables must not absorb custom starting quotes.
[pricingSrc, stripeSrc].forEach((src, i) => {
  const label = ["pricing.js", "stripe-config"][i];
  assertNotIncludes(src, "USD 149", label);
  assertNotIncludes(src, "From USD 149", label);
  assertNotIncludes(src, "USD 399", label);
});

[pricingSrc, homeSrc, formSrc, stripeSrc].forEach((src, i) => {
  const label = ["pricing.js", "index.html", "ai-ads", "stripe-config"][i];
  assertNotIncludes(src, "Automatically renews", label);
  assert(
    !/price_[A-Za-z0-9]{8,}/.test(src) ||
      /DO NOT invent|price_xxxxx|price_xxx\b/.test(src),
    label + " must not hardcode Stripe price IDs"
  );
});

assert(!/\b149\b/.test(pricingSrc.replace(/\/\*[\s\S]*?\*\//g, "")), "pricing.js has no 149 amount");
assert(!/\b399\b/.test(pricingSrc.replace(/\/\*[\s\S]*?\*\//g, "")), "pricing.js has no 399 amount");

["From USD 149", "From USD 399", "Custom Quote", "custom_product_commercial", "brand_story_campaign", "agency_whitelabel"].forEach((s) => {
  assertIncludes(homeSrc, s, "homepage custom production");
  assertIncludes(formSrc, s, "ai-ads custom production");
});
assert((homeSrc.match(/data-price-offer="/g) || []).length === 3, "homepage standard prices only");
assert((formSrc.match(/data-price-offer="/g) || []).length === 3, "ai-ads standard prices only");
assert((homeSrc.match(/data-checkout-service=/g) || []).length === 3, "homepage buy actions stay on standard packages");
assert((formSrc.match(/data-checkout-service=/g) || []).length === 3, "ai-ads buy actions stay on standard packages");
assert(!formSrc.includes('data-checkout-service="custom'), "custom services have no checkout");
assertIncludes(formSrc, "Discuss Agency Partnership", "ai-ads agency CTA");
assert((homeSrc.match(/Quoted in USD, including for Malaysia and Singapore/g) || []).length === 3, "homepage custom quotes name USD for MY/SG");
assert((formSrc.match(/Quoted in USD, including for Malaysia and Singapore/g) || []).length === 3, "ai-ads custom quotes name USD for MY/SG");

// Lookup keys
[
  "ai_short_ad_my",
  "ai_short_ad_sg",
  "ai_short_ad_intl",
  "ai_story_ad_my",
  "ai_story_ad_sg",
  "ai_story_ad_intl",
  "monthly_ai_content_my",
  "monthly_ai_content_sg",
  "monthly_ai_content_intl",
].forEach((k) => {
  assertIncludes(pricingSrc, k, "pricing.js");
  assertIncludes(stripeSrc, k, "stripe-config.js");
});

assertIncludes(stripeSrc, 'mode: "live"', "stripe-config");
assertIncludes(stripeSrc, "checkoutEnabled: true", "stripe-config");
assertIncludes(stripeSrc, "clientMaySubmitAmount: false", "stripe-config");
assertIncludes(stripeSrc, "priceIds: {}", "stripe-config");
assertIncludes(stripeSrc, "/api/checkout", "stripe-config");
assertIncludes(stripeSrc, "/ai-ads/checkout/success/", "stripe-config");
assertIncludes(stripeSrc, "/ai-ads/checkout/cancel/", "stripe-config");
assertIncludes(stripeSrc, "allLookupKeysOk: true", "stripe-config catalog certified");
assertIncludes(stripeSrc, "recurringBillingEnabled: false", "stripe-config no subscriptions");
assertIncludes(homeSrc, "Buy Now", "homepage buy CTA");
assertIncludes(homeSrc, "data-checkout-service", "homepage checkout wiring");
assertIncludes(homeSrc, "One-time payment", "homepage one-time note");
assertIncludes(formSrc, 'data-checkout-service="short"', "ai-ads buy panel");
assertIncludes(formSrc, "Request a Quote", "ai-ads quote path");

// Inquiry is Path B — no package prices / required package select
[
  'name="selected_service"',
  'name="pricing_region"',
  'name="currency"',
  'name="displayed_price"',
  'id="inquiry_type"',
  'name="inquiry_path"',
  "custom_quote",
  "agree_privacy",
].forEach((s) => assertIncludes(formSrc, s, "ai-ads form"));

assertNotIncludes(formSrc, 'id="ad_type"', "ai-ads inquiry has no package select");
assertNotIncludes(formSrc, "order-price-list", "ai-ads inquiry has no duplicated price list");
assertNotIncludes(formSrc, "Selected Package", "ai-ads inquiry has no package fieldset");
assertIncludes(pricingSrc, "N/A — quote request", "pricing.js inquiry sync clears package price");

assertIncludes(homeSrc, "EP01", "homepage story series");
assertIncludes(homeSrc, "Request a Quote", "homepage quote CTA");
assertNotIncludes(homeSrc, "Enquire first", "homepage no stale enquire CTA");
assertNotIncludes(homeSrc, "Submit Inquiry", "homepage uses Request a Quote");

function countryToRegion(cc) {
  if (!cc) return "intl";
  const c = String(cc).toUpperCase();
  if (c === "SG") return "sg";
  if (c === "MY") return "my";
  return "intl";
}

[
  ["SG", "sg"],
  ["MY", "my"],
  ["US", "intl"],
  ["AU", "intl"],
  ["GB", "intl"],
  [null, "intl"],
].forEach(([cc, expect]) => {
  assert(countryToRegion(cc) === expect, "map " + cc + " → " + expect);
});

assertIncludes(homeSrc, "Up to 3 revisions included", "homepage short/story revisions");
assertIncludes(homeSrc, "Up to 3 revisions per video included", "homepage monthly revisions");
assertIncludes(homeSrc, "Includes up to 3 revisions within the approved creative direction", "homepage revision policy");
assertIncludes(formSrc, "A quote request is not a payment", "ai-ads quote is not payment");
assert(!/1 revision included/.test(homeSrc + formSrc), "no stale 1-revision copy");
assert(!/1 revision per video/.test(homeSrc + formSrc), "no stale 1-revision-per-video copy");
assert(!/含 1 次修改/.test(homeSrc + formSrc), "no stale Chinese 1-revision copy");

if (failed) {
  console.error("\nFAILED:", failed);
  process.exit(1);
}
console.log("\nAll pricing checks passed.");
