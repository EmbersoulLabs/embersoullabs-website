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
  "RM 189",
  "RM 399",
  "RM 699 / 30-day package",
  "SGD 79",
  "SGD 169",
  "SGD 299 / 30-day package",
  "USD 59",
  "USD 129",
  "USD 229 / 30-day package",
].forEach((s) => assertIncludes(pricingSrc, s, "pricing.js"));
["RM 69", "SGD 29", "USD 19", "RM 499", "SGD 199"].forEach((s) => {
  const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?!\\d)");
  assert(!re.test(pricingSrc), "pricing.js hides legacy display " + s);
  assert(!re.test(homeSrc), "homepage hides legacy display " + s);
  assert(!re.test(formSrc), "ai-ads hides legacy display " + s);
});

assertIncludes(pricingSrc, "embersoul_pricing_region", "pricing.js");
assertIncludes(pricingSrc, "history.replaceState", "pricing.js keeps a manual market in the URL");
assertIncludes(pricingSrc, "if (getManualRegion()) return;", "pricing.js does not let detection override a manual market");
assertIncludes(pricingSrc, "/cdn-cgi/trace", "pricing.js");
assertIncludes(pricingSrc, 'amount: 229', "pricing.js series USD amount");
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

assert(hasAmount("my", "product", 189), "MY product = 189");
assert(hasAmount("my", "narrative", 399), "MY narrative = 399");
assert(hasAmount("my", "series", 699), "MY series = 699");
assert(hasAmount("sg", "product", 79), "SG product = 79");
assert(hasAmount("sg", "narrative", 169), "SG narrative = 169");
assert(hasAmount("sg", "series", 299), "SG series = 299");
assert(hasAmount("intl", "product", 59), "INTL product = 59");
assert(hasAmount("intl", "narrative", 129), "INTL narrative = 129");
assert(hasAmount("intl", "series", 229), "INTL series = 229");

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
assertNotIncludes(pricingSrc, "USD 399", "pricing.js does not convert the custom USD floor");

["From USD 149", "From USD 399", "Custom Quote", "custom_product_commercial", "brand_story_campaign", "agency_whitelabel"].forEach((s) => {
  assertIncludes(homeSrc, s, "homepage custom production");
  assertIncludes(formSrc, s, "ai-ads custom production");
});
assert((homeSrc.match(/data-price-offer="/g) || []).length === 3, "homepage standard prices only");
assert((formSrc.match(/data-price-offer="/g) || []).length === 3, "ai-ads standard prices only");
assert((homeSrc.match(/data-checkout-service=/g) || []).length === 3, "homepage buy actions stay on standard packages");
assert((formSrc.match(/data-checkout-service=/g) || []).length === 3, "ai-ads buy actions stay on standard packages");
assert(!formSrc.includes('data-checkout-service="custom'), "custom services have no checkout");
assertIncludes(formSrc, "Partner With Us", "ai-ads agency CTA");
assertIncludes(formSrc, "Discuss Your Project", "ai-ads brand story CTA");
assertIncludes(homeSrc, "Partner With Us", "homepage agency CTA");
assertIncludes(homeSrc, "Create My Commercial", "homepage product CTA");
assertIncludes(homeSrc, "Create My Story", "homepage story CTA");
assertIncludes(homeSrc, "Start My Series", "homepage series CTA");
assertIncludes(homeSrc, "4 Connected Episodes · 30–45s Each", "homepage series definition");
assertNotIncludes(homeSrc, "AI Short Ad", "homepage hides short package");
assertNotIncludes(formSrc, "AI Short Ad", "ai-ads hides short package");
assertNotIncludes(homeSrc, 'data-checkout-service="short"', "homepage has no short checkout");
assertNotIncludes(formSrc, 'data-checkout-service="short"', "ai-ads has no short checkout");
assertNotIncludes(homeSrc, "?type=short", "homepage has no short preselection");
assert((homeSrc.match(/Quoted in USD, including for Malaysia and Singapore/g) || []).length === 3, "homepage custom quotes name USD for MY/SG");
assert((formSrc.match(/Quoted in USD, including for Malaysia and Singapore/g) || []).length === 3, "ai-ads custom quotes name USD for MY/SG");

// Lookup keys
[
  "product_commercial_my_v2",
  "product_commercial_sg_v2",
  "product_commercial_intl_v2",
  "story_commercial_my_v2",
  "story_commercial_sg_v2",
  "story_commercial_intl_v2",
  "story_series_my_v2",
  "story_series_sg_v2",
  "story_series_intl_v2",
].forEach((k) => {
  assertIncludes(pricingSrc, k, "pricing.js");
  assertIncludes(stripeSrc, k, "stripe-config.js");
});
[
  "ai_short_ad_my",
  "monthly_ai_content_intl",
].forEach((k) => {
  assertNotIncludes(pricingSrc, k, "pricing.js does not advertise historical keys");
  assertIncludes(stripeSrc, k, "stripe-config preserves historical keys");
});

assertIncludes(stripeSrc, 'mode: "live"', "stripe-config");
assertIncludes(stripeSrc, "checkoutEnabled: true", "stripe-config");
assertIncludes(stripeSrc, "clientMaySubmitAmount: false", "stripe-config");
assertIncludes(stripeSrc, "priceIds: {}", "stripe-config");
assertIncludes(stripeSrc, "/api/checkout", "stripe-config");
assertIncludes(stripeSrc, "/ai-ads/checkout/success/", "stripe-config");
assertIncludes(stripeSrc, "/ai-ads/checkout/cancel/", "stripe-config");
assertIncludes(stripeSrc, "allLookupKeysOk: true", "v2 live prices are certified");
assertIncludes(stripeSrc, "recurringBillingEnabled: false", "stripe-config no subscriptions");
assertIncludes(homeSrc, "data-checkout-service", "homepage checkout wiring");
assertIncludes(homeSrc, "One-time payment", "homepage one-time note");
assertIncludes(formSrc, 'data-checkout-service="product"', "ai-ads product panel");
assertIncludes(formSrc, 'data-checkout-service="narrative"', "ai-ads story panel");
assertIncludes(formSrc, 'data-checkout-service="series"', "ai-ads series panel");
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
assertIncludes(homeSrc, "Up to 3 revisions per episode included", "homepage series revisions");
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
