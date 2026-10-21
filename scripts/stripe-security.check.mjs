/**
 * Security + catalog unit checks (no network, no secrets printed).
 * Run: node scripts/stripe-security.check.mjs
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  getLookupKey,
  normalizeRegion,
  normalizeService,
  LOOKUP_KEYS,
  EXPECTED_UNIT_AMOUNTS,
} from "../functions/_shared/catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

// Catalog mapping
assert(getLookupKey("product", "sg") === "product_commercial_sg_v2", "map product+sg");
assert(getLookupKey("narrative", "my") === "story_commercial_my_v2", "map narrative+my");
assert(getLookupKey("series", "intl") === "story_series_intl_v2", "map series+intl");
assert(getLookupKey("short", "my") === "ai_short_ad_my", "historical short+my");
assert(getLookupKey("story", "sg") === "ai_story_ad_sg", "historical story+sg");
assert(getLookupKey("monthly", "intl") === "monthly_ai_content_intl", "historical monthly+intl");
assert(getLookupKey("hack", "my") === null, "reject bad service");
assert(normalizeService("SHORT") === "short", "service normalize");
assert(normalizeService("enterprise") === null, "reject arbitrary service");
assert(normalizeRegion("jp") === null, "reject arbitrary region");
assert(normalizeRegion("us") === "intl", "us maps to intl");
assert(getLookupKey("short", "us") === "ai_short_ad_intl", "us → intl lookup");

assert(EXPECTED_UNIT_AMOUNTS.story_commercial_intl_v2.unit_amount === 12900, "USD story commercial 129");
assert(EXPECTED_UNIT_AMOUNTS.product_commercial_sg_v2.unit_amount === 7900, "SGD product 79");
assert(EXPECTED_UNIT_AMOUNTS.story_series_my_v2.unit_amount === 69900, "MYR series 699");
assert(EXPECTED_UNIT_AMOUNTS.ai_short_ad_my.unit_amount === 6900, "historical MY short 69");

// Client files must not contain secrets
const clientFiles = [
  "js/stripe-config.js",
  "js/pricing.js",
  "index.html",
  "ai-ads/index.html",
  "ai-ads/checkout/success/index.html",
  "ai-ads/checkout/cancel/index.html",
  "functions/api/checkout.js",
  "functions/api/stripe-webhook.js",
  "functions/_shared/stripe.js",
  "functions/_shared/catalog.js",
];

for (const f of clientFiles) {
  const src = readFileSync(join(root, f), "utf8");
  assert(!/sk_test_[A-Za-z0-9]{10,}/.test(src), f + " has no sk_test secret");
  assert(!/sk_live_[A-Za-z0-9]{10,}/.test(src), f + " has no sk_live secret");
  assert(!/pk_test_[A-Za-z0-9]{20,}/.test(src), f + " has no embedded pk_test");
}

const stripeConfig = readFileSync(join(root, "js/stripe-config.js"), "utf8");
assert(stripeConfig.includes("checkoutEnabled: true"), "checkout gated on");
assert(stripeConfig.includes("clientMaySubmitAmount: false"), "client amount rejected flag");

const checkoutFn = readFileSync(join(root, "functions/api/checkout.js"), "utf8");
const checkoutValidate = readFileSync(
  join(root, "functions/_shared/checkout-validate.js"),
  "utf8"
);
assert(
  checkoutFn.includes("validateCheckoutBody") ||
    checkoutValidate.includes("client_amount_rejected"),
  "endpoint rejects client amounts"
);
const checkoutOrder = readFileSync(join(root, "functions/_shared/checkout-order.js"), "utf8");
assert(
  checkoutFn.includes('mode: "payment"') || checkoutOrder.includes('mode: "payment"'),
  "one-time payment mode"
);
assert(
  !checkoutFn.includes('mode: "subscription"') && !checkoutOrder.includes('mode: "subscription"'),
  "no subscription mode in checkout"
);

const success = readFileSync(
  join(root, "ai-ads/checkout/success/index.html"),
  "utf8"
);
assert(
  success.includes("does not confirm payment") ||
    success.includes("We're verifying your payment"),
  "success page non-confirming"
);

const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
assert(gitignore.includes("stripe.local.txt"), "gitignore covers stripe.local.txt");
assert(gitignore.includes(".dev.vars"), "gitignore covers .dev.vars");
assert(gitignore.includes(".env"), "gitignore covers .env");

assert(!existsSync(join(root, "stripe.local.txt")), "no stripe.local.txt inside website repo");

// All 9 keys present in catalog
let keyCount = 0;
for (const s of Object.keys(LOOKUP_KEYS)) {
  for (const r of Object.keys(LOOKUP_KEYS[s])) keyCount++;
}
assert(keyCount === 18, "9 purchasable v2 keys plus 9 historical keys");

if (failed) {
  console.error("\nFAILED:", failed);
  process.exit(1);
}
console.log("\nAll stripe security checks passed.");
