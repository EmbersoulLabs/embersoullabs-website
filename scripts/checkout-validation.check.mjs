/**
 * Local Checkout validation tests (no Live charge / no Session create).
 * Run: node scripts/checkout-validation.check.mjs
 *
 * 1) All 9 service+region → lookup_key mappings
 * 2) Invalid service/region fail closed
 * 3) Client amount/currency/price_id/lookup_key rejected
 * 4) Optional: Live dry_run price resolve via Stripe API (no session)
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const { validateCheckoutBody } = await import(
  pathToFileURL(join(root, "functions/_shared/checkout-validate.js")).href
);
const { getLookupKey, getExpectedAmount, getPackageFacts } = await import(
  pathToFileURL(join(root, "functions/_shared/catalog.js")).href
);

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

const expectedMap = [
  ["product", "my", "product_commercial_my_v2"],
  ["product", "sg", "product_commercial_sg_v2"],
  ["product", "intl", "product_commercial_intl_v2"],
  ["narrative", "my", "story_commercial_my_v2"],
  ["narrative", "sg", "story_commercial_sg_v2"],
  ["narrative", "intl", "story_commercial_intl_v2"],
  ["series", "my", "story_series_my_v2"],
  ["series", "sg", "story_series_sg_v2"],
  ["series", "intl", "story_series_intl_v2"],
];
const legacyMap = [
  ["short", "my", "ai_short_ad_my"],
  ["short", "sg", "ai_short_ad_sg"],
  ["short", "intl", "ai_short_ad_intl"],
  ["story", "my", "ai_story_ad_my"],
  ["story", "sg", "ai_story_ad_sg"],
  ["story", "intl", "ai_story_ad_intl"],
  ["monthly", "my", "monthly_ai_content_my"],
  ["monthly", "sg", "monthly_ai_content_sg"],
  ["monthly", "intl", "monthly_ai_content_intl"],
];

for (const [s, r, key] of expectedMap) {
  assert(getLookupKey(s, r) === key, `map ${s}+${r} → ${key}`);
  const v = validateCheckoutBody({ service: s, region: r });
  assert(v.ok === true && v.lookupKey === key, `validate ${s}+${r}`);
}

assert(validateCheckoutBody({ service: "hack", region: "my" }).ok === false, "reject bad service");
assert(validateCheckoutBody({ service: "product", region: "jp" }).ok === false, "reject bad region");
for (const [s, r, key] of legacyMap) {
  assert(getLookupKey(s, r) === key, `historical map ${s}+${r}`);
  const hidden = validateCheckoutBody({ service: s, region: r });
  assert(hidden.ok === false && hidden.code === "legacy_package_hidden", `hide ${s}+${r}`);
}
assert(
  validateCheckoutBody({ service: "product", region: "my", amount: 1 }).code ===
    "client_amount_rejected",
  "reject client amount"
);
assert(
  validateCheckoutBody({ service: "product", region: "my", currency: "USD" }).code ===
    "client_amount_rejected",
  "reject client currency"
);
assert(
  validateCheckoutBody({
    service: "product",
    region: "my",
    price_id: "price_fake",
  }).code === "client_amount_rejected",
  "reject client price_id"
);
assert(
  validateCheckoutBody({
    service: "product",
    region: "my",
    lookup_key: "product_commercial_intl_v2",
  }).code === "client_amount_rejected",
  "reject client lookup_key"
);
assert(
  validateCheckoutBody({
    service: "product",
    region: "my",
    displayed_price: "RM 1",
  }).code === "client_amount_rejected",
  "reject displayed_price authority"
);

// Client files security
const clientFiles = [
  "js/stripe-config.js",
  "js/pricing.js",
  "index.html",
  "ai-ads/index.html",
  "ai-ads/checkout/success/index.html",
  "ai-ads/checkout/cancel/index.html",
];
for (const f of clientFiles) {
  const src = readFileSync(join(root, f), "utf8");
  assert(!/sk_(live|test)_[A-Za-z0-9]{10,}/.test(src), f + " no sk secret");
  assert(!/rk_(live|test)_[A-Za-z0-9]{10,}/.test(src), f + " no rk secret");
  assert(!/whsec_[A-Za-z0-9]+/.test(src), f + " no webhook secret");
}

const stripeConfig = readFileSync(join(root, "js/stripe-config.js"), "utf8");
assert(stripeConfig.includes("checkoutEnabled: true"), "checkoutEnabled true");
assert(stripeConfig.includes("clientMaySubmitAmount: false"), "client amount false");

const checkoutFn = readFileSync(join(root, "functions/api/checkout.js"), "utf8");
const checkoutOrder = readFileSync(join(root, "functions/_shared/checkout-order.js"), "utf8");
assert(checkoutOrder.includes('mode: "payment"'), "payment mode");
assert(checkoutOrder.includes("package_version"), "package_version metadata");
assert(!/mode:\s*"subscription"/.test(checkoutFn + checkoutOrder), "no subscription checkout");

const success = readFileSync(
  join(root, "ai-ads/checkout/success/index.html"),
  "utf8"
);
assert(success.includes("We're verifying your payment"), "success verifying copy");
assert(success.includes("Payment received"), "success paid copy");
assert(success.includes("/api/orders/status") && success.includes("access_token"), "success verifies via authorized order API");
assert(success.includes('name="asset_links"') && success.includes('name="asset_status"'), "paid brief collects photo links");

const cancel = readFileSync(
  join(root, "ai-ads/checkout/cancel/index.html"),
  "utf8"
);
assert(cancel.includes("Payment was not completed"), "cancel copy");
assert(cancel.includes("No order has been started"), "cancel no order");

const seriesFacts = getPackageFacts("series");
assert(seriesFacts && seriesFacts.episodes === "4", "series is four episodes");
assert(seriesFacts.continuity === "connected", "series continuity");
assert(seriesFacts.duration === "30-45s", "series episode duration");
assert(getPackageFacts("product").duration === "15-20s", "product duration");
assert(getPackageFacts("narrative").duration === "48-60s", "narrative duration");
assert(getPackageFacts("short") === null, "hidden short has no new facts");

const { resolvePriceByLookupKey } = await import(
  pathToFileURL(join(root, "functions/_shared/stripe.js")).href
);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const text = String(url);
  const key = decodeURIComponent((text.match(/lookup_keys(?:%5B%5D|\[\])=([^&]+)/) || [])[1] || "");
  if (key === "story_series_my_v2_missing") {
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }
  if (key === "story_series_my_v2_recurring") {
    return new Response(
      JSON.stringify({ data: [{ id: "price_mock", type: "recurring", currency: "myr", unit_amount: 69900 }] }),
      { status: 200 }
    );
  }
  const expected = getExpectedAmount(key);
  if (!expected) return new Response(JSON.stringify({ data: [] }), { status: 200 });
  const amount = key.endsWith("_mismatch") ? 1 : expected.unit_amount;
  return new Response(
    JSON.stringify({
      data: [{ id: "price_mock_" + key, type: "one_time", currency: expected.currency, unit_amount: amount, lookup_key: key }],
    }),
    { status: 200 }
  );
};
for (const [, , key] of expectedMap) {
  const resolved = await resolvePriceByLookupKey("sk_test_mock", key, getExpectedAmount(key));
  assert(resolved.ok === true && resolved.price && resolved.price.id === "price_mock_" + key, `mock resolve ${key}`);
}
const mismatch = await resolvePriceByLookupKey(
  "sk_test_mock",
  "story_series_my_v2",
  { currency: "myr", unit_amount: 1 }
);
assert(mismatch.ok === false && mismatch.code === "amount_mismatch", "mock amount mismatch");
const recurring = await resolvePriceByLookupKey(
  "sk_test_mock",
  "story_series_my_v2_recurring",
  { currency: "myr", unit_amount: 69900 }
);
assert(recurring.ok === false && recurring.code === "not_one_time", "mock reject recurring");
const missing = await resolvePriceByLookupKey("sk_test_mock", "story_series_my_v2_missing", null);
assert(missing.ok === false && missing.code === "lookup_key_missing", "mock missing key fails closed");
globalThis.fetch = realFetch;
console.log("STRIPE_TEST_MODE=mock");

// Live dry-run of historical prices only (NO session / NO charge / NO v2 create)
const secretFile = join(root, "..", "stripe.local.txt");
let secretRaw = "";
try {
  secretRaw = readFileSync(secretFile, "utf8");
} catch {
  secretRaw = "";
}
const rk = (secretRaw.match(/rk_live_[A-Za-z0-9]+/) || [])[0];
const sk = (secretRaw.match(/sk_live_[A-Za-z0-9]+/) || [])[0];
const secret = rk || sk;

if (secret) {
  console.log("DRY_RUN_PRICE_RESOLVE=start SECRET_PRINTED=NO");
  for (const [, , key] of legacyMap) {
    const expected = getExpectedAmount(key);
    const resolved = await resolvePriceByLookupKey(secret, key, expected);
    assert(
      resolved.ok === true,
      `historical dry_run ${key}` + (resolved.ok ? "" : " :: " + resolved.error)
    );
  }
  for (const [, , key] of expectedMap) {
    const expected = getExpectedAmount(key);
    const resolved = await resolvePriceByLookupKey(secret, key, expected);
    assert(
      resolved.ok === true && resolved.price && resolved.price.type === "one_time" && resolved.price.active === true,
      `v2 dry_run ${key}` + (resolved.ok ? "" : " :: " + resolved.error)
    );
  }
  console.log("V2_LIVE_PRICES_VALID=9");
  console.log("DRY_RUN_SESSIONS_CREATED=0");
  console.log("LIVE_CHARGE_CREATED=NO");
} else {
  console.log("SKIP dry_run resolve (no live secret in stripe.local.txt)");
}

if (failed) {
  console.error("\nFAILED:", failed);
  process.exit(1);
}
console.log("\nAll checkout validation checks passed.");
