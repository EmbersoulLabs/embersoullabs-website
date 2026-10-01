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
const { getLookupKey } = await import(
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
assert(validateCheckoutBody({ service: "short", region: "jp" }).ok === false, "reject bad region");
assert(
  validateCheckoutBody({ service: "short", region: "my", amount: 1 }).code ===
    "client_amount_rejected",
  "reject client amount"
);
assert(
  validateCheckoutBody({ service: "short", region: "my", currency: "USD" }).code ===
    "client_amount_rejected",
  "reject client currency"
);
assert(
  validateCheckoutBody({
    service: "short",
    region: "my",
    price_id: "price_fake",
  }).code === "client_amount_rejected",
  "reject client price_id"
);
assert(
  validateCheckoutBody({
    service: "short",
    region: "my",
    lookup_key: "ai_short_ad_intl",
  }).code === "client_amount_rejected",
  "reject client lookup_key"
);
assert(
  validateCheckoutBody({
    service: "short",
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
assert(checkoutFn.includes('mode: "payment"'), "payment mode");
assert(checkoutFn.includes("package_version"), "package_version metadata");
assert(!/mode:\s*"subscription"/.test(checkoutFn), "no subscription checkout");

const success = readFileSync(
  join(root, "ai-ads/checkout/success/index.html"),
  "utf8"
);
assert(success.includes("We're verifying your payment"), "success verifying copy");
assert(success.includes("Payment received"), "success paid copy");
assert(success.includes("/api/checkout/session"), "success verifies via API");

const cancel = readFileSync(
  join(root, "ai-ads/checkout/cancel/index.html"),
  "utf8"
);
assert(cancel.includes("Payment was not completed"), "cancel copy");
assert(cancel.includes("No order has been started"), "cancel no order");

// Live dry-run price resolve (NO session / NO charge)
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
  const { resolvePriceByLookupKey } = await import(
    pathToFileURL(join(root, "functions/_shared/stripe.js")).href
  );
  const { getExpectedAmount } = await import(
    pathToFileURL(join(root, "functions/_shared/catalog.js")).href
  );
  for (const [s, r, key] of expectedMap) {
    const expected = getExpectedAmount(key);
    const resolved = await resolvePriceByLookupKey(secret, key, expected);
    assert(
      resolved.ok === true,
      `dry_run resolve ${key}` + (resolved.ok ? "" : " :: " + resolved.error)
    );
  }
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
