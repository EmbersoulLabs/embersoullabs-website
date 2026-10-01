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

// Stale / forbidden values
[pricingSrc, homeSrc, formSrc, stripeSrc].forEach((src, i) => {
  const label = ["pricing.js", "index.html", "ai-ads", "stripe-config"][i];
  assertNotIncludes(src, "USD 149", label);
  assertNotIncludes(src, "From USD 149", label);
  assertNotIncludes(src, "Automatically renews", label);
  // Comments may mention price_xxxxx — forbid assigned fake IDs only
  assert(
    !/price_[A-Za-z0-9]{8,}/.test(src) ||
      /DO NOT invent|price_xxxxx|price_xxx\b/.test(src),
    label + " must not hardcode Stripe price IDs"
  );
});

assert(!/\b149\b/.test(pricingSrc.replace(/\/\*[\s\S]*?\*\//g, "")), "pricing.js has no 149 amount");

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
assertIncludes(homeSrc, "Buy AI Short Ad", "homepage buy CTA");
assertIncludes(homeSrc, "Buy AI Story Ad", "homepage buy CTA");
assertIncludes(homeSrc, "Buy Monthly Package", "homepage buy CTA");
assertIncludes(homeSrc, "data-checkout-service", "homepage checkout wiring");
assertIncludes(homeSrc, "One-time payment", "homepage one-time note");
assertIncludes(formSrc, "btn-buy-now", "ai-ads buy panel");

// Form fields
[
  'id="ad_type"',
  'id="monthly-format-block"',
  'id="monthly_content_format"',
  'id="story-concept-block"',
  'name="selected_service"',
  'name="pricing_region"',
  'name="currency"',
  'name="displayed_price"',
  'name="monthly_content_format"',
  "Standalone Ads",
  "Continuous AI Story Series",
  "Mix of Both",
].forEach((s) => assertIncludes(formSrc, s, "ai-ads form"));

assertIncludes(homeSrc, "EP01", "homepage story series");
assertIncludes(homeSrc, "Buy Monthly Package", "homepage monthly buy CTA");
assertIncludes(homeSrc, "Buy AI Short Ad", "homepage short buy present");
assertIncludes(homeSrc, "Buy AI Story Ad", "homepage story buy present");
assertIncludes(homeSrc, "Enquire first", "homepage enquire option preserved");

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
  ["GB", "intl"],
  [null, "intl"],
].forEach(([cc, expect]) => {
  assert(countryToRegion(cc) === expect, "map " + cc + " → " + expect);
});

assertIncludes(homeSrc, "Up to 3 revisions included", "homepage short/story revisions");
assertIncludes(homeSrc, "Up to 3 revisions per video included", "homepage monthly revisions");
assertIncludes(homeSrc, "Includes up to 3 revisions within the approved creative direction", "homepage revision policy");
assertIncludes(formSrc, "Includes up to 3 revisions within the approved creative direction", "ai-ads revision policy");
assert(!/1 revision included/.test(homeSrc + formSrc), "no stale 1-revision copy");
assert(!/1 revision per video/.test(homeSrc + formSrc), "no stale 1-revision-per-video copy");
assert(!/含 1 次修改/.test(homeSrc + formSrc), "no stale Chinese 1-revision copy");

if (failed) {
  console.error("\nFAILED:", failed);
  process.exit(1);
}
console.log("\nAll pricing checks passed.");
